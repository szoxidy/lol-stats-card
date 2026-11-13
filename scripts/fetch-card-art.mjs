import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from '../src/collector.mjs';
const directory = path.join(root, 'assets/art');
await mkdir(directory, { recursive: true });
const sources = { 'miss-fortune': 'MissFortune_16', ahri: 'Ahri_0', yasuo: 'Yasuo_0', jinx: 'Jinx_0' };
const manifest = [];
for (const [key, name] of Object.entries(sources)) {
  const url = `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${name}.jpg`;
  const file = path.join(directory, `${key}.jpg`);
  let bytes;
  try { bytes = await readFile(file); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
    if (!response.ok) throw new Error(`原画获取失败：${key} / ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('原画格式无效。');
    await writeFile(file, bytes);
  }
  manifest.push({ key, source: url, bytes: bytes.length });
}
await writeFile(path.join(directory, 'sources.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify(manifest.map(({ key, bytes }) => ({ key, bytes }))));
