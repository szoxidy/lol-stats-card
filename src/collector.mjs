import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishSnapshot } from './publish.mjs';
import { discoverClient, createLcuClient } from './lcu.mjs';
import { CardError, accountKey, normalizeRanked, normalizeHistory, statistics, validateSnapshot, mergeSnapshots } from './model.mjs';
import { readPlayerConfig } from './settings.mjs';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataFile = () => path.join(process.env.LOL_CARD_DATA_DIR || path.join(root, 'data'), 'profile.json');

export async function readSnapshot(file = dataFile()) {
  try { return validateSnapshot(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw new CardError('STORED_DATA_INVALID', '已有展示数据无法读取；文件已保留，请先检查再同步。'); }
}

export async function saveSnapshot(snapshot, file = dataFile()) {
  const validated = validateSnapshot(snapshot);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporary, file);
  return validated;
}

export async function fetchProfileIcon(profileIconId, { request = fetch } = {}) {
  if (!Number.isInteger(profileIconId) || profileIconId < 0 || profileIconId > 1_000_000) throw new CardError('PROFILE_ICON_INVALID', '头像编号无效。');
  const { version } = JSON.parse(await readFile(path.join(root, 'assets/source.json'), 'utf8'));
  const response = await request(`https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${profileIconId}.png`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new CardError('PROFILE_ICON_UNAVAILABLE', `官方头像图片暂不可用（HTTP ${response.status}）。`);
  const png = Buffer.from(await response.arrayBuffer());
  if (png.length > 128 * 1024 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new CardError('PROFILE_ICON_INVALID', '官方头像图片格式或大小无效。');
  return `data:image/png;base64,${png.toString('base64')}`;
}

export async function collectSnapshot({ discover = discoverClient, makeClient = createLcuClient, resolveProfileIcon = fetchProfileIcon, now = () => new Date().toISOString(), expectedPlayer } = {}) {
  if (expectedPlayer === undefined) expectedPlayer = await readPlayerConfig();
  const connection = await discover();
  const get = makeClient(connection);
  const summoner = await get('/lol-summoner/v1/current-summoner');
  if (!(summoner.gameName || summoner.displayName) || !summoner.puuid) throw new CardError('PROFILE_INCOMPLETE', '玩家资料还未加载完成，请等待客户端首页出现后再同步。');
  if (expectedPlayer && ((summoner.gameName || summoner.displayName).normalize('NFC') !== expectedPlayer.name.normalize('NFC') || String(summoner.tagLine || '') !== expectedPlayer.tag)) {
    throw new CardError('ACCOUNT_MISMATCH', '当前客户端账号与配置的昵称/标签不一致，本次未保存。');
  }
  const timestamp = now();
  const settled = await Promise.allSettled([
    get('/lol-ranked/v1/current-ranked-stats'),
    get(`/lol-match-history/v1/products/lol/${encodeURIComponent(summoner.puuid)}/matches?begIndex=0&endIndex=19`),
    get('/riotclient/region-locale')
  ]);
  const value = i => settled[i].status === 'fulfilled' ? settled[i].value : null;
  let catalog = {};
  try { catalog = JSON.parse(await readFile(path.join(root, 'assets/champions.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new CardError('CATALOG_INVALID', '本地英雄资料文件无效，请运行 pnpm assets 更新。'); }
  const region = connection.region || value(2)?.region || '国服';
  const history = normalizeHistory(value(1), summoner, catalog, timestamp);
  const top = statistics(history.games).champions;
  const profileIconId = Number.isInteger(summoner.profileIconId) && summoner.profileIconId >= 0 ? summoner.profileIconId : null;
  let profileIconSource = 'client';
  const assetTasks = [profileIconId === null ? Promise.resolve(null) : get(`/lol-game-data/assets/v1/profile-icons/${profileIconId}.jpg`, true).catch(() => { profileIconSource = 'data-dragon'; return resolveProfileIcon(profileIconId); }), ...top.map(c => get(`/lol-game-data/assets/v1/champion-icons/${c.id}.png`, true))];
  const icons = await Promise.allSettled(assetTasks);
  const icon = i => icons[i].status === 'fulfilled' ? icons[i].value : null;
  return validateSnapshot({
    version: 1, accountKey: accountKey(summoner, region), syncedAt: timestamp,
    profile: { name: summoner.gameName || summoner.displayName, tag: summoner.tagLine || '', level: summoner.summonerLevel, region, profileIconId },
    ranked: normalizeRanked(value(0), timestamp), history,
    assets: { profileIcon: icon(0), profileIconSource: icon(0) ? profileIconSource : null, champions: Object.fromEntries(top.map((c, i) => [c.id, icon(i + 1)])) }
  });
}

async function main() {
  const probe = process.argv.includes('--probe');
  const incoming = await collectSnapshot();
  const merged = mergeSnapshots(await readSnapshot(), incoming);
  if (!probe) await saveSnapshot(merged);
  const stats = statistics(merged.history.games);
  console.log(JSON.stringify({ ok: true, saved: !probe, profile: '已读取', avatar: merged.assets.profileIcon ? 'ready' : 'unavailable', ranked: merged.ranked.status, history: merged.history.status, validGames: stats.count, excludedGames: merged.history.excluded, syncedAt: merged.syncedAt }, null, 2));
  if (!probe) {
    const targets = await publishSnapshot(merged);
    if (targets.length) console.log(JSON.stringify({ targets }, null, 2));
    if (targets.some(target => !target.ok)) process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(JSON.stringify({ ok: false, code: error instanceof CardError ? error.code : 'SYNC_FAILED', message: error instanceof CardError ? error.message : '同步未完成，已有数据保持原样。' }));
    process.exitCode = 1;
  });
}
