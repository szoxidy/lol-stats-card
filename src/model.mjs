import { createHash } from 'node:crypto';

export class CardError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export const QUEUE_PRESETS = [
  { id: 'all', label: '全部模式', queues: null },
  { id: 'solo', label: '单双排', queues: [420] },
  { id: 'flex', label: '灵活排位', queues: [440] },
  { id: 'ranked', label: '排位模式', queues: [420, 440] },
  { id: 'hextech', label: '海克斯大乱斗', queues: [2400] },
  { id: 'aram', label: '极地大乱斗', queues: [450] },
  { id: 'normal', label: '匹配模式', queues: [400, 430, 490] }
];

export function selectHistory(games, queue = 'all') {
  const selected = QUEUE_PRESETS.find(preset => preset.id === queue);
  if (!selected) throw new CardError('QUEUE_INVALID', '不支持的对局模式。');
  return { ...selected, games: selected.queues ? games.filter(game => selected.queues.includes(game.queueId)) : games };
}

const integer = (value, max = 1_000_000) => Number.isInteger(value) && value >= 0 && value <= max;
const text = (value, max = 80) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const imageData = value => typeof value === 'string' && value.length <= 180_000 && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : null;
const TIERS = new Set(['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER', 'NONE']);
// KIWI / 2400 is ARAM: Mayhem; preserve its mode instead of relabeling it as ARAM.
const supportedMode = (mode, queueId) => ['CLASSIC', 'ARAM'].includes(mode) || (mode === 'KIWI' && queueId === 2400);

export function accountKey(summoner, region) {
  if (!summoner.puuid) throw new CardError('PROFILE_INCOMPLETE', '客户端尚未返回完整玩家资料，请确认已登录。');
  return createHash('sha256').update(`${region}:${summoner.puuid}`).digest('hex');
}

function rankedEntry(entry) {
  if (!entry || typeof entry !== 'object' || !TIERS.has(entry.tier)) return null;
  return {
    tier: entry.tier,
    division: ['I', 'II', 'III', 'IV'].includes(entry.division) ? entry.division : '',
    leaguePoints: integer(entry.leaguePoints) ? entry.leaguePoints : null,
    wins: integer(entry.wins) ? entry.wins : null,
    losses: integer(entry.losses) ? entry.losses : null,
    provisional: entry.isProvisional === true || entry.provisional === true
  };
}

export function normalizeRanked(raw, timestamp) {
  const find = key => raw?.queueMap?.[key] ?? raw?.queues?.find(q => q.queueType === key);
  const solo = rankedEntry(find('RANKED_SOLO_5x5'));
  const flex = rankedEntry(find('RANKED_FLEX_SR'));
  return { status: solo || flex ? 'ready' : 'unavailable', updatedAt: solo || flex ? timestamp : null, solo, flex };
}

export function normalizeHistory(raw, summoner, champions = {}, timestamp = new Date().toISOString()) {
  const rows = Array.isArray(raw?.games?.games) ? raw.games.games : Array.isArray(raw?.games) ? raw.games : null;
  if (!rows) return { status: 'unavailable', updatedAt: null, fetched: 0, excluded: 0, games: [] };
  const games = [], seen = new Set();
  let excluded = 0;
  for (const game of rows.slice(0, 20)) {
    const identity = game.participantIdentities?.find(p =>
      (summoner.puuid && p.player?.puuid === summoner.puuid) ||
      (integer(summoner.summonerId) && summoner.summonerId > 0 && p.player?.summonerId === summoner.summonerId));
    const participant = identity && game.participants?.find(p => p.participantId === identity.participantId);
    const stats = participant?.stats;
    const gameId = String(game.gameId ?? '');
    if (!gameId || seen.has(gameId) || !supportedMode(game.gameMode, game.queueId) ||
      (game.gameType && game.gameType !== 'MATCHED_GAME') ||
      !stats || typeof stats.win !== 'boolean' ||
      !['kills', 'deaths', 'assists'].every(k => integer(stats[k], 1000)) ||
      !integer(participant.championId, 10000) || participant.championId === 0 ||
      !integer(game.gameDuration, 86400) || game.gameDuration === 0 ||
      (game.gameDuration < 300 && stats.gameEndedInEarlySurrender === true)) {
      excluded++; continue;
    }
    seen.add(gameId);
    const created = Date.parse(game.gameCreationDate) || game.gameCreation;
    const ended = new Date(created + game.gameDuration * 1000);
    games.push({
      championId: participant.championId,
      championName: text(champions[participant.championId]?.name || `英雄 ${participant.championId}`, 32),
      won: stats.win, kills: stats.kills, deaths: stats.deaths, assists: stats.assists,
      queueId: integer(game.queueId, 10000) ? game.queueId : null,
      mode: game.gameMode,
      endedAt: Number.isFinite(ended.getTime()) ? ended.toISOString() : null
    });
  }
  games.sort((a, b) => (Date.parse(b.endedAt) || 0) - (Date.parse(a.endedAt) || 0));
  return { status: 'ready', updatedAt: timestamp, fetched: Math.min(rows.length, 20), excluded, games };
}

export function statistics(games) {
  if (!games.length) return { count: 0, wins: 0, losses: 0, winRate: null, kda: null, average: null, champions: [] };
  const totals = games.reduce((r, g) => ({ wins: r.wins + Number(g.won), kills: r.kills + g.kills, deaths: r.deaths + g.deaths, assists: r.assists + g.assists }), { wins: 0, kills: 0, deaths: 0, assists: 0 });
  const groups = new Map();
  for (const game of games) {
    const group = groups.get(game.championId) || { id: game.championId, name: game.championName, count: 0 };
    group.count++; groups.set(game.championId, group);
  }
  return {
    count: games.length, wins: totals.wins, losses: games.length - totals.wins,
    winRate: Math.round(totals.wins / games.length * 100),
    kda: Number(((totals.kills + totals.assists) / Math.max(1, totals.deaths)).toFixed(2)),
    average: ['kills', 'deaths', 'assists'].map(k => (totals[k] / games.length).toFixed(1)),
    champions: [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 3)
  };
}

// 所有持久化和上传数据都重新选字段；接口原文及客户端凭据不能穿过这里。
export function validateSnapshot(input) {
  if (input?.version !== 1 || !/^[a-f0-9]{64}$/.test(input.accountKey || '') || !iso(input.syncedAt) || !text(input.profile?.name)) {
    throw new CardError('INVALID_SNAPSHOT', '同步数据缺少有效的玩家资料或时间。');
  }
  const statuses = new Set(['ready', 'stale', 'unavailable']);
  const sourceGames = input.history?.games;
  if (!Array.isArray(sourceGames) || sourceGames.length > 20) throw new CardError('INVALID_SNAPSHOT', '对局数据格式无效。');
  const games = sourceGames.map(g => {
    if (!integer(g.championId, 10000) || g.championId === 0 || typeof g.won !== 'boolean' ||
      !['kills', 'deaths', 'assists'].every(k => integer(g[k], 1000)) || !supportedMode(g.mode, g.queueId)) {
      throw new CardError('INVALID_SNAPSHOT', '对局统计字段无效。');
    }
    return { championId: g.championId, championName: text(g.championName, 32), won: g.won, kills: g.kills, deaths: g.deaths, assists: g.assists, queueId: integer(g.queueId, 10000) ? g.queueId : null, mode: g.mode, endedAt: iso(g.endedAt) };
  });
  const status = section => statuses.has(section?.status) ? section.status : 'unavailable';
  const championIcons = {};
  for (const id of new Set(games.map(g => g.championId))) {
    const icon = imageData(input.assets?.champions?.[id]);
    if (icon && Object.keys(championIcons).length < 3) championIcons[id] = icon;
  }
  const profileIcon = imageData(input.assets?.profileIcon);
  const profileIconSource = profileIcon && ['client', 'data-dragon', 'reference-match'].includes(input.assets?.profileIconSource) ? input.assets.profileIconSource : null;
  return {
    version: 1, accountKey: input.accountKey, syncedAt: iso(input.syncedAt),
    profile: { name: text(input.profile.name), tag: text(input.profile.tag, 20), level: integer(input.profile.level) ? input.profile.level : null, region: text(input.profile.region, 40), profileIconId: integer(input.profile.profileIconId) ? input.profile.profileIconId : null },
    ranked: { status: status(input.ranked), updatedAt: iso(input.ranked?.updatedAt), solo: rankedEntry(input.ranked?.solo), flex: rankedEntry(input.ranked?.flex) },
    history: { status: status(input.history), updatedAt: iso(input.history.updatedAt), fetched: integer(input.history.fetched, 20) ? input.history.fetched : 0, excluded: integer(input.history.excluded, 20) ? input.history.excluded : 0, games },
    assets: { profileIcon, profileIconSource, champions: championIcons }
  };
}

export function mergeSnapshots(previous, incoming) {
  const next = validateSnapshot(incoming);
  if (!previous || previous.accountKey !== next.accountKey) return next;
  if (Date.parse(next.syncedAt) < Date.parse(previous.syncedAt)) throw new CardError('STALE_SNAPSHOT', '收到的快照比现有数据更旧，已保留现有数据。');
  for (const section of ['ranked', 'history']) {
    if (next[section].status === 'unavailable' && previous[section].updatedAt) next[section] = { ...previous[section], status: 'stale' };
  }
  const sameIcon = next.profile.profileIconId === null || next.profile.profileIconId === previous.profile.profileIconId;
  if (next.profile.profileIconId === null) next.profile.profileIconId = previous.profile.profileIconId;
  if (sameIcon && !next.assets.profileIcon) {
    next.assets.profileIcon = previous.assets?.profileIcon || null;
    next.assets.profileIconSource = previous.assets?.profileIconSource || null;
  }
  const top = statistics(next.history.games).champions;
  next.assets.champions = Object.fromEntries(top.map(c => [c.id, next.assets.champions[c.id] || previous.assets?.champions?.[c.id]]).filter(([, value]) => value));
  return validateSnapshot(next);
}

export function publicSnapshot(snapshot) {
  if (!snapshot) return { status: 'waiting', profile: null };
  const { accountKey: _privateKey, ...publicData } = snapshot;
  return { ...publicData, status: 'ready', statistics: statistics(snapshot.history.games) };
}
