import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { normalizeHistory, normalizeRanked, statistics, validateSnapshot, mergeSnapshots, publicSnapshot, CardError, selectHistory } from '../src/model.mjs';
import { parseCommandLine, parseLockfile, createLcuClient, selectClientProcess } from '../src/lcu.mjs';
import { collectSnapshot, saveSnapshot, readSnapshot } from '../src/collector.mjs';
import { publishSnapshot } from '../src/publish.mjs';
import { createCardServer } from '../src/server.mjs';
import { renderCard } from '../src/render.mjs';
import { readPlayerConfig } from '../src/settings.mjs';

const timestamp = '2026-11-10T08:00:00.000Z';
const owner = { puuid: 'fixture-owner', summonerId: 7, gameName: '测试玩家', tagLine: '00000', summonerLevel: 8 };
const fixtureAvatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jzpgAAAAASUVORK5CYII=';
function game(id = 1, overrides = {}) {
  return { gameId: id, gameMode: 'CLASSIC', gameType: 'MATCHED_GAME', gameDuration: 1800, gameCreationDate: '2026-11-09T08:00:00.000Z', queueId: 420,
    participantIdentities: [{ participantId: 1, player: { puuid: 'fixture-other' } }, { participantId: 2, player: { puuid: owner.puuid } }],
    participants: [{ participantId: 1, championId: 1, stats: { kills: 99, deaths: 0, assists: 99, win: false } }, { participantId: 2, championId: 103, stats: { kills: 5, deaths: 2, assists: 7, win: true } }], ...overrides };
}
function fixture() {
  return { version: 1, accountKey: 'a'.repeat(64), syncedAt: timestamp,
    profile: { name: owner.gameName, tag: owner.tagLine, level: 8, region: 'fixture-region' },
    ranked: normalizeRanked({ queueMap: { RANKED_SOLO_5x5: { tier: 'GOLD', division: 'IV', leaguePoints: 0, wins: 4, losses: 3 } } }, timestamp),
    history: normalizeHistory({ games: { games: [game()] } }, owner, { 103: { name: '测试英雄' } }, timestamp), assets: { profileIcon: null, champions: {} } };
}
async function sandbox(t) {
  const prefix = path.join(tmpdir(), 'lol-card-test-');
  const directory = await mkdtemp(prefix);
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.resolve(prefix))); await rm(directory, { recursive: true, force: true }); });
  return directory;
}
async function service(t, options) {
  const server = createCardServer(options);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('公开源码缺少私人账号配置时使用示例配置，已有配置及格式错误不能被覆盖', async t => {
  const directory = await sandbox(t), file = path.join(directory, 'player.json');
  assert.equal((await readPlayerConfig(file)).tag, 'EXAMPLE');
  await writeFile(file, JSON.stringify({ name: '配置玩家', tag: 'TEST', region: 'HN1' }));
  assert.equal((await readPlayerConfig(file)).name, '配置玩家');
  await writeFile(file, '{invalid');
  await assert.rejects(readPlayerConfig(file), SyntaxError);
});

test('对局关闭大厅界面时仍识别后台客户端，显式进程与多账号分别处理', () => {
  const backend = {Name:'LeagueClient.exe',ProcessId:1}, ui = {Name:'LeagueClientUx.exe',ProcessId:2};
  assert.equal(selectClientProcess([backend]), backend);
  assert.equal(selectClientProcess([backend,ui]), ui);
  assert.equal(selectClientProcess([backend,ui],'1'), backend);
  assert.throws(() => selectClientProcess([backend], '99'), {code:'CLIENT_PID_NOT_FOUND'});
  assert.throws(() => selectClientProcess([backend,{...backend,ProcessId:3}]), {code:'MULTIPLE_CLIENTS'});
});

test('对局只统计本人；重复、重开和未识别对局排除，结束时间包含对局时长', () => {
  const remake = game(2, { gameDuration: 180 }); remake.participants[1].stats.gameEndedInEarlySurrender = true;
  const history = normalizeHistory({ games: { games: [game(), game(), remake, game(3, { participantIdentities: [] }), game(4, { gameMode: 'CHERRY' })] } }, owner, {}, timestamp);
  assert.equal(history.games.length, 1); assert.equal(history.excluded, 4);
  assert.deepEqual(statistics(history.games), { count: 1, wins: 1, losses: 0, winRate: 100, kda: 6, average: ['5.0', '2.0', '7.0'], champions: [{ id: 103, name: '英雄 103', count: 1 }] });
  assert.equal(history.games[0].endedAt, '2026-11-09T08:30:00.000Z');
});

test('模式分类区分单双排、灵活、海克斯、极地与匹配，不将游戏模式相同的队列混合', () => {
  const games = [420, 440, 2400, 450, 400].map(queueId => ({queueId}));
  assert.deepEqual(selectHistory(games, 'solo').games.map(game => game.queueId), [420]);
  assert.deepEqual(selectHistory(games, 'ranked').games.map(game => game.queueId), [420, 440]);
  assert.deepEqual(selectHistory(games, 'hextech').games.map(game => game.queueId), [2400]);
  assert.deepEqual(selectHistory(games, 'aram').games.map(game => game.queueId), [450]);
  assert.deepEqual(selectHistory(games, 'normal').games.map(game => game.queueId), [400]);
  assert.equal(selectHistory(games).games.length, 5);
  assert.throws(() => selectHistory(games, 'unknown'), {code:'QUEUE_INVALID'});
});

test('空历史、未知段位和零死亡分别有明确含义', () => {
  assert.equal(normalizeHistory(null, owner).status, 'unavailable');
  assert.equal(normalizeHistory({ games: { games: [] } }, owner).status, 'ready');
  assert.equal(statistics([]).winRate, null);
  assert.equal(normalizeRanked({}, timestamp).solo, null);
  const g = fixture().history.games[0]; g.deaths = 0;
  assert.equal(statistics([g]).kda, 12);
});

test('近20局包含15场海克斯大乱斗时完整统计，并保留模式与正确展示', () => {
  const rows = Array.from({ length: 20 }, (_, index) => {
    const row = game(index + 1, { gameMode: index < 15 ? 'KIWI' : 'CLASSIC', queueId: index < 15 ? 2400 : 440 });
    row.participants[1].stats.win = index < 12;
    return row;
  });
  const history = normalizeHistory({ games: { games: rows } }, owner, {}, timestamp);
  assert.equal(history.fetched, 20);
  assert.equal(history.excluded, 0);
  assert.equal(history.games.length, 20);
  assert.equal(history.games.filter(g => g.mode === 'KIWI').length, 15);
  assert.equal(statistics(history.games).winRate, 60);
  const data = fixture(); data.history = history; data.profile.region = 'HN1';
  const clean = validateSnapshot(data);
  assert.deepEqual(clean.history.games, history.games);
  const svg = renderCard(clean, { layout: 'wide' });
  assert.ok(svg.includes('海克斯大乱斗'));
  assert.ok(svg.includes('艾欧尼亚'));
  assert.equal(normalizeHistory({ games: [game(21, { gameMode: 'KIWI', queueId: 420 })] }, owner).excluded, 1);
  const invalid = fixture(); invalid.history.games[0].mode = 'KIWI';
  assert.throws(() => validateSnapshot(invalid), { code: 'INVALID_SNAPSHOT' });
});

test('模式参数同时筛选近期胜率和场数，排位赛季记录保持独立，无匹配对局不混入其他模式', async t => {
  const directory = await sandbox(t), file = path.join(directory, 'profile.json');
  const rows = Array.from({ length: 20 }, (_, index) => {
    const row = game(index + 1, { gameMode: index < 15 ? 'KIWI' : 'CLASSIC', queueId: index < 15 ? 2400 : 440 });
    row.participants[1].stats.win = index < 12;
    return row;
  });
  const data = fixture(); data.history = normalizeHistory({ games: rows }, owner, {}, timestamp);
  await saveSnapshot(data, file);
  const base = await service(t, { file });
  const flex = await (await fetch(`${base}/card.svg?queue=flex`)).text();
  assert.ok(flex.includes('灵活排位 · 5场'), '模式参数必须显示筛选后的真实场数');
  assert.ok(/data-stat="recent-win-rate"[^>]*>0%/.test(flex), '近期胜率只能使用选中模式的对局');
  assert.ok(flex.includes('4胜 3负'), '赛季排位胜负不应使用近期对局覆盖');
  const hextech = await (await fetch(`${base}/card.svg?queue=hextech`)).text();
  assert.ok(hextech.includes('海克斯大乱斗 · 15场'));
  assert.ok(/data-stat="recent-win-rate"[^>]*>80%/.test(hextech));
  const solo = await (await fetch(`${base}/card.svg?queue=solo`)).text();
  assert.ok(solo.includes('单双排 · 0场'));
  assert.ok(solo.includes('当前快照没有该模式对局'));
  assert.equal((await fetch(`${base}/card.svg?queue=not-a-queue`)).status, 422);
});

test('持久化白名单去掉原始身份/凭据，展示数据不含内部账号哈希', () => {
  const data = fixture(); data.puuid = 'private-fixture'; data.token = 'private-fixture'; data.profile.qq = 'private-fixture'; data.history.games[0].player = owner;
  const clean = validateSnapshot(data);
  assert.ok(!JSON.stringify(clean).includes('private-fixture'));
  assert.ok(!JSON.stringify(clean).includes(owner.puuid));
  assert.ok(!('accountKey' in publicSnapshot(clean)));
  assert.throws(() => validateSnapshot({ ...data, accountKey: '' }));
});

test('接口暂不可用保留同一账号旧战绩，明确标为旧数据；拒收更旧快照', () => {
  const previous = fixture(), incoming = fixture();
  incoming.syncedAt = '2026-11-10T09:00:00.000Z'; incoming.history = normalizeHistory(null, owner);
  const merged = mergeSnapshots(previous, incoming);
  assert.equal(merged.history.status, 'stale'); assert.equal(merged.history.updatedAt, timestamp); assert.equal(merged.history.games.length, 1);
  incoming.accountKey = 'b'.repeat(64);
  assert.equal(mergeSnapshots(previous, incoming).history.games.length, 0);
  assert.throws(() => mergeSnapshots(merged, previous), { code: 'STALE_SNAPSHOT' });
});

test('连接信息只用于回环 GET，禁止添加其他客户端接口', async () => {
  const connection = parseLockfile('LeagueClient:123:29999:fixture-password:https');
  assert.equal(connection.port, 29999);
  assert.equal(parseCommandLine('--app-port=29999 --remoting-auth-token=fixture --rso-platform-id=HN1', 123).region, 'HN1');
  assert.throws(() => parseLockfile('bad:1:99999:fixture:http'));
  await assert.rejects(createLcuClient(connection)('/lol-lobby/v2/lobby'), { code: 'ENDPOINT_FORBIDDEN' });
});

test('采集走阿卡林使用的资料/段位/战绩入口；账号不符时停止', async () => {
  const calls = [];
  const options = { expectedPlayer: { name: owner.gameName, tag: owner.tagLine }, discover: async () => ({ region: 'fixture-region' }), now: () => timestamp,
    makeClient: () => async endpoint => { calls.push(endpoint); if (endpoint === '/lol-summoner/v1/current-summoner') return owner; if (endpoint === '/lol-ranked/v1/current-ranked-stats') return { queueMap: {} }; if (endpoint.includes('/matches?')) return { games: { games: [game()] } }; throw new Error('fixture endpoint unavailable'); } };
  const data = await collectSnapshot(options);
  assert.equal(data.profile.name, owner.gameName); assert.equal(data.history.games.length, 1);
  assert.ok(calls.includes('/lol-ranked/v1/current-ranked-stats'));
  assert.ok(calls.includes('/lol-match-history/v1/products/lol/fixture-owner/matches?begIndex=0&endIndex=19'));
  await assert.rejects(collectSnapshot({ ...options, expectedPlayer: { name: '其他配置', tag: '0' } }), { code: 'ACCOUNT_MISMATCH' });
});

test('客户端图片不可用时按真实头像编号取图，保存后离线仍能显示；不以英雄代替头像', async t => {
  const requested = [];
  const data = await collectSnapshot({
    expectedPlayer: { name: owner.gameName, tag: owner.tagLine },
    discover: async () => ({ region: 'fixture-region' }), now: () => timestamp,
    makeClient: () => async endpoint => {
      if (endpoint === '/lol-summoner/v1/current-summoner') return { ...owner, profileIconId: 42 };
      if (endpoint.includes('/matches?')) return { games: [game()] };
      if (endpoint === '/lol-ranked/v1/current-ranked-stats') return { queueMap: {} };
      throw new Error('本机图片接口不可用');
    },
    resolveProfileIcon: async id => { requested.push(id); return fixtureAvatar; }
  });
  assert.equal(data.profile.profileIconId, 42);
  assert.deepEqual(requested, [42]);
  assert.equal(data.assets.profileIcon, fixtureAvatar);
  assert.equal(data.assets.profileIconSource, 'data-dragon');
  const directory = await sandbox(t), file = path.join(directory, 'profile.json');
  await saveSnapshot(data, file);
  const saved = await readSnapshot(file);
  assert.equal(saved.profile.profileIconId, 42);
  assert.equal(saved.assets.profileIconSource, 'data-dragon');
  assert.ok(renderCard(saved).includes(fixtureAvatar));
  const missing = fixture(); missing.profile.profileIconId = 42;
  const svg = renderCard(missing, { championIcons: { 103: fixtureAvatar } });
  assert.ok(svg.includes('头像待补'));
  assert.ok(!svg.includes('左侧图片为近期常用英雄'));
});

test('同一账号头像编号改变且新图未就绪时，不沿用旧头像；同编号失败保留原图', () => {
  const previous = fixture(), incoming = fixture();
  previous.profile.profileIconId = 42; previous.assets.profileIcon = fixtureAvatar;
  incoming.profile.profileIconId = 43;
  assert.equal(mergeSnapshots(previous, incoming).assets.profileIcon, null);
  incoming.profile.profileIconId = 42;
  assert.equal(mergeSnapshots(previous, incoming).assets.profileIcon, fixtureAvatar);
});

test('两端并发发布同一快照，一端失败不影响另一端，不返回认证信息', async () => {
  const calls = [];
  const result = await publishSnapshot(fixture(), { targets: [{ name: '国内', url: 'https://cn.example/lol-card/api/snapshot', tokenEnv: 'TOKEN_CN' }, { name: '国外', url: 'https://global.example/api/snapshot', tokenEnv: 'TOKEN_GLOBAL' }],
    env: { TOKEN_CN: 'c'.repeat(32), TOKEN_GLOBAL: 'g'.repeat(32) }, request: async (url, options) => { calls.push({ host: url.hostname, body: options.body }); if (url.hostname === 'cn.example') throw new Error('fixture failure'); return { ok: true, status: 200 }; } });
  assert.equal(calls.length, 2); assert.equal(calls[0].body, calls[1].body);
  assert.deepEqual(result, [{ name: '国内', ok: false, code: 'UPLOAD_FAILED' }, { name: '国外', ok: true, code: 'SYNCED' }]);
  assert.ok(!JSON.stringify(result).includes('https://')); assert.ok(!JSON.stringify(result).includes('Bearer'));
});

test('两套独立 HTTP 服务：认证写入、SVG 读回、失败保留和禁止跨站同步', async t => {
  const directory = await sandbox(t), data = fixture();
  const common = { localSync: true, collect: async () => { throw new CardError('CLIENT_NOT_RUNNING', '测试未启动客户端'); }, publish: async () => [] };
  const cnFile = path.join(directory, 'cn/profile.json'), globalFile = path.join(directory, 'global/profile.json');
  const cn = await service(t, { ...common, file: cnFile, region: '国内', syncToken: 'c'.repeat(32) });
  const global = await service(t, { ...common, file: globalFile, region: '国外', syncToken: 'g'.repeat(32) });
  const waiting = await (await fetch(`${cn}/card.svg`)).text();
  assert.equal((await (await fetch(`${cn}/api/profile`)).json()).current.status, 'waiting');
  assert.ok(waiting.includes('等待首次更新 · 尚无战绩资料')); assert.ok(!waiting.includes('2179'));
  assert.equal((await fetch(`${cn}/api/snapshot`, { method: 'PUT', body: JSON.stringify(data) })).status, 401);
  for (const [base, token] of [[cn, 'c'.repeat(32)], [global, 'g'.repeat(32)]]) {
    assert.equal((await fetch(`${base}/api/snapshot`, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(data) })).status, 200);
  }
  assert.equal(await readFile(cnFile, 'utf8'), await readFile(globalFile, 'utf8'));
  assert.equal(await (await fetch(`${cn}/card.svg?theme=light&layout=wide`)).text(), await (await fetch(`${global}/card.svg?theme=light&layout=wide`)).text());
  assert.equal((await fetch(`${cn}/api/sync`, { method: 'POST', headers: { Origin: 'https://elsewhere.example' } })).status, 403);
  assert.equal((await fetch(`${cn}/api/sync`, { method: 'POST', headers: { Origin: cn } })).status, 422);
  assert.deepEqual(await readSnapshot(cnFile), validateSnapshot(data));
  assert.equal((await (await fetch(`${global}/health`)).json()).region, '国外');
  assert.ok(!JSON.stringify(await (await fetch(`${cn}/api/profile`)).json()).includes(data.accountKey));
  const imageResponse = await fetch(`${cn}/card.svg?motion=static`);
  assert.match(imageResponse.headers.get('cache-control'), /max-age=60/);
  assert.equal((await fetch(`${cn}/card.svg?motion=static`, { headers: { 'If-None-Match': imageResponse.headers.get('etag') } })).status, 304);
});

test('逐帧模式包含24个独立帧并尊重减少动画；静态模式完全去掉动画', () => {
  const animated = renderCard(fixture(), { motion: 'frames' });
  assert.equal((animated.match(/class="film /g) || []).length, 24);
  assert.match(animated, /steps\(1,end\)/);
  assert.match(animated, /prefers-reduced-motion:reduce/);
  const still = renderCard(fixture(), { motion: 'static' });
  assert.doesNotMatch(still, /@keyframes|class="film |class="mote|<script|<animate/);
  assert.equal(renderCard(fixture(), { motion: 'subtle' }).includes('class="film '), false);
});

test('默认模式不连接游戏客户端，预览与刷新只读已有快照', async t => {
  const directory = await sandbox(t);
  let calls = 0;
  const base = await service(t, { file: path.join(directory, 'profile.json'), collect: async () => { calls++; return fixture(); } });
  const profile = await (await fetch(`${base}/api/profile`)).json();
  assert.equal(profile.dataSource.automatic, false);
  assert.equal(profile.dataSource.mode, 'remote');
  assert.equal(profile.dataSource.status, 'not_configured');
  await fetch(`${base}/card.svg`);
  assert.equal((await fetch(`${base}/api/sync`, { method: 'POST', headers: { Origin: base } })).status, 403);
  assert.equal(calls, 0);
  const html = await (await fetch(base)).text();
  assert.ok(html.includes('刷新预览')); assert.ok(!html.includes('登录国服客户端'));
});

test('SVG 转义玩家文本，四种外观都保持独立图片和明确数据来源', () => {
  const data = fixture(); data.profile.name = '<script>&"';
  for (const theme of ['dark', 'light']) for (const layout of ['compact', 'wide']) {
    const svg = renderCard(data, { theme, layout });
    assert.ok(!svg.includes('<script>')); assert.ok(svg.includes('&lt;script&gt;'));
    assert.ok(svg.includes('最近同步'));
    assert.doesNotMatch(svg, /(?:href=["']|url\(["']?)https?:\/\//);
    assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(svg.includes(layout === 'wide' ? 'viewBox="0 0 550 320"' : 'viewBox="0 0 400 120"'));
  }
});
