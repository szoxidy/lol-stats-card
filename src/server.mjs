import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { timingSafeEqual, createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CardError, mergeSnapshots, publicSnapshot, statistics, selectHistory } from './model.mjs';
import { collectSnapshot, readSnapshot, saveSnapshot, root } from './collector.mjs';
import { renderCard } from './render.mjs';
import { publishSnapshot } from './publish.mjs';
import { readPlayerConfig } from './settings.mjs';

const files = new Map([['/', ['public/index.html', 'text/html; charset=utf-8']], ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['public/style.css', 'text/css; charset=utf-8']]]);
const safeError = error => error instanceof CardError ? { code: error.code, message: error.message } : { code: 'REQUEST_FAILED', message: '操作未完成，已有数据已保留。' };

const configuredPlayer = await readPlayerConfig();
const roundedFont = `data:font/woff2;base64,${(await readFile(path.join(root, 'assets/fonts/comfortaa-latin.woff2'))).toString('base64')}`;
const championCatalog = JSON.parse(await readFile(path.join(root, 'assets/champions.json'), 'utf8'));
const championNames = Object.fromEntries(Object.entries(championCatalog).map(([id, champion]) => [id, champion.title || champion.name]));
const artwork = new Map();
async function cardArtwork(name) {
  const selected = ['miss-fortune', 'ahri', 'yasuo', 'jinx'].includes(name) ? name : 'miss-fortune';
  if (!artwork.has(selected)) artwork.set(selected, (async () => {
    try { return `data:image/webp;base64,${(await readFile(path.join(root, `assets/art/${selected}.webp`))).toString('base64')}`; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { return `data:image/jpeg;base64,${(await readFile(path.join(root, `assets/art/${selected}.jpg`))).toString('base64')}`; }
    catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  })().catch(error => { artwork.delete(selected); throw error; }));
  return artwork.get(selected);
}

const iconFiles = new Map();
async function localIcon(filename, mime) {
  if (!iconFiles.has(filename)) iconFiles.set(filename, readFile(path.join(root, 'assets/icons', filename))
    .then(bytes => `data:image/${mime};base64,${bytes.toString('base64')}`)
    .catch(error => { iconFiles.delete(filename); if (error.code !== 'ENOENT') throw error; return null; }));
  return iconFiles.get(filename);
}

async function cardIcons(snapshot, queue = 'all') {
  const selection = selectHistory(snapshot?.history?.games || [], queue), games = selection.games;
  const ids = new Set([...statistics(games).champions.map(c => c.id), ...games.slice(0, 5).map(game => game.championId)]);
  const rankKeys = ['all', 'ranked'].includes(selection.id) ? ['solo', 'flex'] : ['solo', 'flex'].includes(selection.id) ? [selection.id] : [];
  const tiers = new Set(rankKeys.map(key => snapshot?.ranked?.[key]?.tier).filter(t => t && t !== 'NONE'));
  const [champions, ranks] = await Promise.all([
    Promise.all([...ids].map(async id => [id, await localIcon(`champions/${id}.webp`, 'webp')])),
    Promise.all([...tiers].map(async tier => [tier, await localIcon(`ranks/${tier.toLowerCase()}.webp`, 'webp')]))
  ]);
  return { championIcons: Object.fromEntries(champions.filter(([, icon]) => icon)), rankedEmblems: Object.fromEntries(ranks.filter(([, icon]) => icon)), championNames };
}

export function createCardServer({ file, collect = collectSnapshot, publish = publishSnapshot, syncToken = process.env.LOL_CARD_SYNC_TOKEN, localSync = process.env.LOL_CARD_ENABLE_LOCAL_SYNC === '1', player = configuredPlayer, region = process.env.LOL_CARD_REGION || '本地' } = {}) {
  let busy = false;
  const current = () => readSnapshot(file);
  const send = (res, status, body, type = 'application/json; charset=utf-8', extra = {}) => {
    const content = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(content), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...extra });
    res.end(content);
  };
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && files.has(url.pathname)) {
        const [filename, type] = files.get(url.pathname);
        send(res, 200, await readFile(path.join(root, filename)), type, { 'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'" }); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/profile') {
        send(res, 200, { current: publicSnapshot(await current()), player, region, dataSource: { mode: 'remote', status: 'not_configured', automatic: false } }); return;
      }
      if (req.method === 'GET' && url.pathname === '/health') {
        send(res, 200, { ok: true, region, hasData: Boolean(await current()), version: '0.1.0' }); return;
      }
      if (req.method === 'GET' && url.pathname === '/card.svg') {
        const saved = await current();
        const [art, icons] = await Promise.all([cardArtwork(url.searchParams.get('background')), cardIcons(saved, url.searchParams.get('queue') || 'all')]);
        const svg = renderCard(saved, { layout: url.searchParams.get('layout'), theme: url.searchParams.get('theme'), queue: url.searchParams.get('queue') || 'all', player, art, background: url.searchParams.get('background'), motion: url.searchParams.get('motion'), font: roundedFont, ...icons });
        const tag = `"${createHash('sha256').update(svg).digest('hex').slice(0, 24)}"`;
        const headers = { ETag: tag, 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300', 'Content-Security-Policy': "default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'", ...(url.searchParams.has('download') ? { 'Content-Disposition': 'attachment; filename="lol-card.svg"' } : {}) };
        if (req.headers['if-none-match'] === tag) { res.writeHead(304, headers); res.end(); return; }
        send(res, 200, svg, 'image/svg+xml; charset=utf-8', headers); return;
      }
      if (req.method === 'POST' && url.pathname === '/api/sync') {
        const host = req.headers.host || '';
        const isLoopbackHost = /^(?:127\.0\.0\.1|localhost):\d+$/.test(host);
        if (!localSync || !isLoopbackHost || req.headers.origin !== `http://${host}` || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) {
          send(res, 403, { code: 'LOCAL_ONLY', message: '请从本机预览页发起客户端同步。' }); return;
        }
        if (busy) { send(res, 409, { code: 'SYNC_BUSY', message: '正在同步，请等待完成。' }); return; }
        busy = true;
        try {
          const saved = await saveSnapshot(mergeSnapshots(await current(), await collect()), file);
          let targets;
          try { targets = await publish(saved); }
          catch (error) { targets = [{ name: '远端配置', ok: false, code: error instanceof CardError ? error.code : 'PUBLISH_FAILED' }]; }
          send(res, 200, { ...publicSnapshot(saved), targets });
        }
        finally { busy = false; }
        return;
      }
      if (req.method === 'PUT' && url.pathname === '/api/snapshot') {
        const supplied = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
        const a = Buffer.from(supplied), b = Buffer.from(syncToken || '');
        if (!syncToken || b.length < 32 || a.length !== b.length || !timingSafeEqual(a, b)) { send(res, 401, { code: 'UNAUTHORIZED', message: '远端同步未启用或凭据无效。' }); return; }
        if (busy) { send(res, 409, { code: 'SYNC_BUSY', message: '正在保存另一次同步，请稍后重试。' }); return; }
        busy = true;
        try {
          let size = 0; const chunks = [];
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 700 * 1024) throw new CardError('BODY_TOO_LARGE', '同步数据超过允许大小。');
            chunks.push(chunk);
          }
          let incoming;
          try { incoming = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
          catch { throw new CardError('INVALID_JSON', '同步数据不是有效 JSON。'); }
          const saved = await saveSnapshot(mergeSnapshots(await current(), incoming), file);
          send(res, 200, { ok: true, syncedAt: saved.syncedAt });
        } finally { busy = false; }
        return;
      }
      send(res, 404, { message: '没有这个地址。' });
    } catch (error) { if (!res.headersSent) send(res, error instanceof CardError ? 422 : 500, safeError(error)); else res.end(); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.LOL_CARD_PORT || 4187), host = process.env.LOL_CARD_HOST || '127.0.0.1';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('LOL_CARD_PORT 必须是有效端口。');
  const server = createCardServer();
  server.on('error', () => { console.error('本地服务启动失败，请检查端口是否被占用。'); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`英雄联盟卡片预览：http://${host}:${port}`));
}
