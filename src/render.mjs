import { statistics, selectHistory } from './model.mjs';
import { motionLayers } from './motion.mjs';
import { levelBadge } from './graphics.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);
const TIERS = { IRON: '黑铁', BRONZE: '黄铜', SILVER: '白银', GOLD: '黄金', PLATINUM: '铂金', EMERALD: '翡翠', DIAMOND: '钻石', MASTER: '超凡大师', GRANDMASTER: '傲世宗师', CHALLENGER: '最强王者', NONE: '未定级' };
const rankName = rank => rank ? `${TIERS[rank.tier] || rank.tier}${rank.division ? ` ${rank.division}` : ''}` : '段位待更新';
const date = value => value ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '';
const modeName = game => ({ 420: '单双排', 440: '灵活排位', 450: '极地大乱斗', 2400: '海克斯大乱斗' })[game.queueId] || (game.mode === 'CLASSIC' ? '匹配模式' : '其他模式');
const seasonRecord = rank => Number.isInteger(rank?.wins) && Number.isInteger(rank?.losses)
  ? `${rank.wins}胜 ${rank.losses}负${rank.wins + rank.losses ? ` · ${(rank.wins / (rank.wins + rank.losses) * 100).toFixed(1)}%` : ''}` : '赛季记录待更新';

export function renderCard(snapshot, options = {}) {
  const mini = options.layout === 'compact', width = mini ? 400 : 550, height = mini ? 120 : 320;
  const light = options.theme === 'light';
  const palette = light
    ? { body: '#f8f4f9', text: '#3e3049', muted: '#77667f', line: '#d9cddf', win: '#327d63', loss: '#aa506f' }
    : { body: '#25212b', text: '#f8f2fb', muted: '#c1afcd', line: '#51445b', win: '#9edfc1', loss: '#df91ad' };
  const profile = snapshot?.profile || options.player || {};
  const name = profile.name || '英雄联盟', region = profile.region === 'HN1' ? '艾欧尼亚' : profile.region || '国服';
  const allGames = snapshot?.history?.games || [];
  const selection = selectHistory(allGames, options.queue || 'all'), games = selection.games;
  const available = snapshot?.history && snapshot.history.status !== 'unavailable';
  const stats = available ? statistics(games) : null, latest = games[0];
  const solo = snapshot?.ranked?.solo, flex = snapshot?.ranked?.flex;
  const synced = options.demo ? '演示资料 · 不代表真实账号' : snapshot ? `最近同步 ${date(snapshot.syncedAt)}` : '等待首次更新 · 尚无战绩资料';
  const stale = ['ranked', 'history'].some(key => snapshot?.[key]?.status === 'stale');
  const scope = `${selection.label} · ${stats?.count ?? 0}场`;
  const sourceScope = selection.id === 'all' ? `最近${snapshot?.history?.fetched || 0}局${new Set(games.map(game => game.mode)).size > 1 ? ' · 混合模式' : ''}` : `从最近${snapshot?.history?.fetched || 0}局中筛选`;
  const text = (x, y, content, size = 12, color = palette.text, weight = 400, attrs = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" ${attrs}>${escape(content)}</text>`;
  const embedded = new Map();
  const image = (href, x, y, w, h = w, attrs = '') => {
    if (!href) return '';
    if (!embedded.has(href)) embedded.set(href, `card-image-${embedded.size}`);
    return `<g ${attrs}><svg x="${x}" y="${y}" width="${w}" height="${h}" viewBox="0 0 1 1"><use href="#${embedded.get(href)}"/></svg></g>`;
  };
  const icon = id => snapshot?.assets?.champions?.[id] || options.championIcons?.[id];
  const emblem = (rank, x, y, size) => image(options.rankedEmblems?.[rank?.tier], x, y, size, size, 'class="rank-crest"');
  const avatar = snapshot?.assets?.profileIcon;
  const portrait = (x, y, size) => `<rect x="${x - 2}" y="${y - 2}" width="${size + 4}" height="${size + 4}" rx="10" fill="#21182b" fill-opacity=".72"/>${avatar ? image(avatar, x, y, size, size, 'clip-path="url(#avatar)"') : `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="8" fill="#3b2e45"/>${text(x + size / 2, y + size / 2 + 4, '头像待补', 10, '#d3bfdc', 400, 'text-anchor="middle"')}`}<rect x="${x + .5}" y="${y + .5}" width="${size - 1}" height="${size - 1}" rx="8" fill="none" stroke="#f4d9f5" stroke-opacity=".35"/>`;
  const results = (x, y, count, step, size) => games.slice(0, count).map((game, index) => `<rect x="${x + index * step}" y="${y}" width="${size}" height="${size}" rx="${Math.min(2, size / 2)}" fill="${game.won ? palette.win : palette.loss}"><title>${escape(`${index + 1}：${game.championName}，${game.won ? '胜利' : '失败'}，${modeName(game)}`)}</title></rect>`).join('');
  const backgroundName = options.background || 'miss-fortune';
  const animation = motionLayers(options.motion || 'subtle', { mini, background: backgroundName, headerHeight: mini ? 120 : 120 });
  const artDefinition = options.art ? `<image id="hero-art" width="550" height="325" href="${options.art}"/>` : '';
  const art = options.art ? `<use href="#hero-art" y="${backgroundName === 'miss-fortune' ? -10 : -30}"/>` : '<rect width="550" height="325" fill="#4c354e"/>';
  let content;
  if (mini) {
    const selectedRank = selection.id === 'flex' ? flex : solo;
    content = `<g clip-path="url(#banner)"><g transform="scale(.727273)">${art}<rect width="550" height="165" fill="url(#shade)"/>${animation.atmosphere}</g></g>
      ${portrait(16, 17, 62)}${levelBadge(profile.level, 69, 84, 12)}
      ${text(94, 37, name, Array.from(name).length > 7 ? 16 : 22, '#fff', 600)}${text(95, 56, `#${profile.tag || '—'}`, 11, '#e0cceb')}
      ${text(95, 76, region, 10.5, '#e9dcef')}${text(95, 96, stats?.count ? `${selection.id === 'all' ? `近${stats.count}局` : `${selection.label}${stats.count}场`}  ${stats.winRate}%胜率` : '暂无该模式战绩', selection.label.length > 5 ? 8.5 : 10, '#e0cceb')}
      ${emblem(selectedRank, 236, 17, 46)}${text(288, 37, rankName(selectedRank), (TIERS[selectedRank?.tier] || '').length > 3 ? 13 : 18, '#fff', 500)}
      ${text(289, 56, selectedRank?.leaguePoints !== null && selectedRank?.leaguePoints !== undefined ? `${selectedRank.leaguePoints} LP` : '胜点待更新', 10, '#e0cceb')}
      ${games.slice(0, 5).map((game, index) => `<g><title>${escape(`${game.championName}，${game.won ? '胜利' : '失败'}`)}</title>${image(icon(game.championId), 245 + index * 28, 77, 22, 22, `clip-path="url(#recent-${index})"`)}<rect x="${245 + index * 28}" y="77" width="22" height="22" rx="4" fill="none" stroke="${game.won ? palette.win : palette.loss}" stroke-width="1.5"/>${!icon(game.championId) ? text(256 + index * 28, 92, game.won ? '胜' : '负', 10, game.won ? palette.win : palette.loss, 400, 'text-anchor="middle"') : ''}</g>`).join('')}${text(16, 113, synced, 7.5, '#cfb9d8')}${text(384, 113, '最近五场', 7.5, '#cfb9d8', 400, 'text-anchor="end"')}`;
  } else {
    const rankRow = (rank, label, y, primary = false) => `${emblem(rank, 20, y - 13, primary ? 64 : 46)}${text(primary ? 96 : 78, y, label, 9.5, palette.muted)}${text(primary ? 96 : 78, y + 26, rankName(rank), primary ? 25 : 19, palette.text, 500)}${text(290, y + 25, rank?.leaguePoints !== null && rank?.leaguePoints !== undefined ? `${rank.leaguePoints} LP` : '—', 11.5, palette.muted, 400, 'text-anchor="end"')}${text(primary ? 96 : 78, y + 43, seasonRecord(rank), 9.5, palette.muted)}`;
    const champions = (stats?.champions || []).map((champion, index) => {
      const x = 20 + index * 96;
      const label = options.championNames?.[champion.id] || champion.name;
      return `${image(icon(champion.id), x, 274, 28, 28, `clip-path="url(#champion-${index})"`)}${text(x + 34, 285, label.length > 5 ? `${label.slice(0, 4)}…` : label, 9, palette.text)}${text(x + 34, 300, `${champion.count}场`, 8.5, palette.muted)}`;
    }).join('');
    content = `<g clip-path="url(#banner)">${art}<rect width="550" height="120" fill="url(#shade)"/>${animation.atmosphere}</g>
      ${portrait(20, 18, 80)}${levelBadge(profile.level, 95, 100)}${text(122, 48, name, Array.from(name).length > 10 ? 22 : 30, '#fff', 600)}${text(124, 71, `#${profile.tag || '—'}`, 12, '#e1cdeb')}${text(124, 94, region, 11, '#e8d8f0')}
      ${rankRow(solo, '单双排 · 赛季', 142, true)}${rankRow(flex, '灵活排位 · 赛季', 209)}
      <path d="M315 140v161" stroke="${palette.line}" stroke-opacity=".5"/>
      ${text(336, 143, scope, 10.5, palette.muted)}${text(336, 163, '近期胜率', 9.5, palette.muted)}${text(447, 163, 'KDA', 9.5, palette.muted)}
      ${text(336, 195, stats?.count ? `${stats.winRate}%` : '—', 30, palette.text, 500, 'data-stat="recent-win-rate"')}${text(447, 195, stats?.count ? stats.kda : '—', 27, palette.text, 500, 'data-stat="recent-kda"')}
      ${stats?.count ? `${text(336, 217, `${stats.wins}胜`, 10, palette.win)}${text(379, 217, `${stats.losses}负`, 10, palette.loss)}${results(336, 231, 20, 9.4, 6)}` : text(336, 217, '当前快照没有该模式对局', 9, palette.muted)}
      ${text(20, 265, '近期常用', 9.5, palette.muted)}${champions || text(20, 288, '暂无该模式英雄记录', 10, palette.muted)}
      ${text(336, 265, '最近一局', 9.5, palette.muted)}${latest ? text(530, 265, modeName(latest), 8.5, palette.muted, 400, 'text-anchor="end"') : ''}
      ${latest ? image(icon(latest.championId), 336, 274, 30, 30, 'clip-path="url(#latest-champion)"') : ''}${text(378, 286, latest ? latest.won ? '胜利' : '失败' : '—', 17, latest ? latest.won ? palette.win : palette.loss : palette.muted, 500)}${text(378, 302, latest ? `${latest.kills}/${latest.deaths}/${latest.assists}` : '暂无对局', 10, palette.muted)}
      ${text(20, 315, `${synced}${stale ? ' · 部分旧资料' : ''}`, 7.5, palette.muted)}${text(530, 315, sourceScope, 7.5, palette.muted, 400, 'text-anchor="end"')}`;
  }
  const font = options.font ? `@font-face{font-family:CardRounded;src:url(${options.font}) format('woff2');font-weight:400 700;}` : '';
  const images = [...embedded].map(([href, id]) => `<image id="${id}" width="1" height="1" href="${href}" preserveAspectRatio="xMidYMid meet"/>`).join('');
  const clips = [0, 1, 2].map(index => `<clipPath id="champion-${index}"><rect x="${20 + index * 96}" y="274" width="28" height="28" rx="5"/></clipPath>`).join('');
  const recentClips = Array.from({length:5}, (_, index) => `<clipPath id="recent-${index}"><rect x="${245 + index * 28}" y="77" width="22" height="22" rx="4"/></clipPath>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
    <title id="title">${escape(name)}的英雄联盟个人卡片</title><desc id="desc">${escape(`${rankName(solo)}。${synced}。${scope}，${sourceScope}，统计仅针对已识别的本人对局。赛季排位记录与近期战绩分别显示。${!avatar ? '账号头像尚未读取。' : ''}`)}</desc>
    <style>${font}text{font-family:CardRounded,"Microsoft YaHei","PingFang SC",sans-serif;font-variant-numeric:tabular-nums}image{image-rendering:auto}</style>${animation.style}
    <defs>${artDefinition}${images}<clipPath id="outer"><rect width="${width}" height="${height}" rx="10"/></clipPath><clipPath id="banner"><rect width="${width}" height="120"/></clipPath>
      <clipPath id="avatar"><rect x="${mini ? 16 : 20}" y="${mini ? 17 : 18}" width="${mini ? 62 : 80}" height="${mini ? 62 : 80}" rx="8"/></clipPath>${clips}${recentClips}<clipPath id="latest-champion"><rect x="336" y="274" width="30" height="30" rx="5"/></clipPath>
      <linearGradient id="shade"><stop stop-color="#20192a" stop-opacity=".94"/><stop offset=".42" stop-color="#2e2139" stop-opacity=".74"/><stop offset=".73" stop-color="#20182d" stop-opacity=".18"/><stop offset="1" stop-color="#20182d" stop-opacity="${mini ? '.74' : '.38'}"/></linearGradient>
    </defs><g clip-path="url(#outer)"><rect width="${width}" height="${height}" fill="${palette.body}"/>${content}<rect x=".5" y=".5" width="${width - 1}" height="${height - 1}" rx="9.5" fill="none" stroke="${light ? '#d7c6dd' : '#e8d5f0'}" stroke-opacity="${light ? '.6' : '.1'}"/></g></svg>`;
}
