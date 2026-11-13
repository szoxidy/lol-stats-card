import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { root } from '../src/collector.mjs';

const run = promisify(execFile);
const { version } = JSON.parse(await readFile(path.join(root, 'assets/source.json'), 'utf8'));
const catalog = JSON.parse(await readFile(path.join(root, 'assets/champions.json'), 'utf8'));
const championDirectory = path.join(root, 'assets/icons/champions');
const rankDirectory = path.join(root, 'assets/icons/ranks');
const sourceDirectory = path.join(root, 'output/asset-sources');
let previous;
try { previous = JSON.parse(await readFile(path.join(root, 'assets/icons/sources.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const previousIcons = new Map((previous?.icons || []).map(icon => [`${icon.kind}:${icon.id}`, icon]));
for (const directory of [championDirectory, rankDirectory, sourceDirectory]) await mkdir(directory, { recursive: true });
const tiers = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'emerald', 'diamond', 'master', 'grandmaster', 'challenger'];
const tasks = [
  ...Object.entries(catalog).map(([id, champion]) => ({ kind: 'champion', id, source: `https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${champion.id}.png`, file: path.join(championDirectory, `${id}.webp`) })),
  ...tiers.map(id => ({ kind: 'rank', id, source: `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-static-assets/global/default/images/ranked-emblem/emblem-${id}.png`, file: path.join(rankDirectory, `${id}.webp`) }))
];
const manifest = [], failures = [];
async function fetchIcon(task) {
  let bytes;
  let cachedSource = false;
  try { bytes = await readFile(task.file); if (task.kind === 'rank' && process.argv.includes('--rebuild-ranks')) bytes = null; }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!bytes) {
    const original = task.kind === 'rank' ? path.join(sourceDirectory, `emblem-${task.id}.png`) : path.join(championDirectory, `${task.id}.png`);
    let png;
    try { png = await readFile(original); cachedSource = true; }
    catch (sourceError) {
      if (sourceError.code !== 'ENOENT') throw sourceError;
      const response = await fetch(task.source, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      png = Buffer.from(await response.arrayBuffer());
      await writeFile(original, png);
    }
    if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('图标不是 PNG');
    let crop = '';
    if (task.kind === 'rank') {
      const { stderr } = await run(process.env.LOL_CARD_FFMPEG || 'ffmpeg.exe', ['-hide_banner', '-loglevel', 'info', '-i', original, '-vf', 'alphaextract,cropdetect=limit=0.01:round=2:reset=0:skip=0', '-frames:v', '1', '-f', 'null', '-'], { windowsHide: true, timeout: 10000 });
      crop = [...stderr.matchAll(/crop=(\d+:\d+:\d+:\d+)/g)].at(-1)?.[1];
      if (!crop) throw new Error('RANK_ALPHA_BOUNDS_MISSING');
    }
    const encoding = task.kind === 'rank' ? ['-vf', `crop=${crop},scale=160:-1`, '-lossless', '1'] : ['-vf', 'scale=120:120', '-q:v', '86'];
    await run(process.env.LOL_CARD_FFMPEG || 'ffmpeg.exe', ['-v', 'error', '-y', '-i', original, '-frames:v', '1', '-c:v', 'libwebp', ...encoding, task.file], { windowsHide: true, timeout: 20000 });
    bytes = await readFile(task.file);
  }
  const previousIcon = previousIcons.get(`${task.kind}:${task.id}`);
  const retained = previousIcon && (cachedSource || previousIcon.sha256 === createHash('sha256').update(bytes).digest('hex')) ? previousIcon : null;
  manifest.push({ ...(retained || {}), kind: task.kind, id: task.id, source: retained?.source || task.source, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await Promise.all(Array.from({ length: 4 }, async () => {
  for (;;) {
    const task = tasks.shift();
    if (!task) return;
    try { await fetchIcon(task); } catch (error) { failures.push({ icon: `${task.kind}:${task.id}`, reason: error.cause?.code || error.code || error.message }); }
  }
}));
manifest.sort((a, b) => `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`, 'en', { numeric: true }));
await writeFile(path.join(root, 'assets/icons/sources.json'), `${JSON.stringify({ version, fetchedAt: new Date().toISOString(), icons: manifest }, null, 2)}\n`);
console.log(JSON.stringify({ champions: manifest.filter(i => i.kind === 'champion').length, ranks: manifest.filter(i => i.kind === 'rank').length, bytes: manifest.reduce((sum, i) => sum + i.bytes, 0), failures }));
if (failures.length) process.exitCode = 1;
