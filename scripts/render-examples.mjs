import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCard } from '../src/render.mjs';

// Standalone documentation fixtures. Never read or write the application's data directory.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'examples');
const inline = async (file, mime) => `data:${mime};base64,${(await readFile(path.join(root, file))).toString('base64')}`;
const font = await inline('assets/fonts/comfortaa-latin.woff2', 'font/woff2');
const avatar = await inline('assets/demo/profileicon-29.png', 'image/png');
const champions = JSON.parse(await readFile(path.join(root, 'assets/champions.json'), 'utf8'));
const ids = [103, 222, 157];
const championIcons = Object.fromEntries(await Promise.all(ids.map(async id => [id, await inline(`assets/icons/champions/${id}.webp`, 'image/webp')])));
const rankedEmblems = Object.fromEntries(await Promise.all(['EMERALD', 'PLATINUM'].map(async tier => [tier, await inline(`assets/icons/ranks/${tier.toLowerCase()}.webp`, 'image/webp')])));
const games = Array.from({ length: 20 }, (_, i) => ({
  championId: ids[i < 10 ? 0 : i < 16 ? 1 : 2],
  championName: champions[ids[i < 10 ? 0 : i < 16 ? 1 : 2]].name,
  won: i % 5 < 3, kills: 6 + i % 9, deaths: 3 + i % 6, assists: 9 + i % 13,
  mode: i % 4 ? 'KIWI' : 'CLASSIC', queueId: i % 4 ? 2400 : 440,
  endedAt: '2026-11-01T12:00:00.000Z'
}));
const snapshot = {
  profile: { name: '幻光旅人', tag: 'DEMO', level: 256, region: '艾欧尼亚', profileIconId: 29 },
  syncedAt: '2026-11-01T12:00:00.000Z',
  history: { status: 'ready', fetched: 20, games },
  ranked: { solo: { tier: 'EMERALD', division: 'II', leaguePoints: 64, wins:104, losses:82 }, flex: { tier: 'PLATINUM', division: 'I', leaguePoints: 27, wins:76, losses:72 } },
  assets: { profileIcon: avatar, profileIconSource: 'data-dragon' }
};
await mkdir(directory, { recursive: true });
const variants = [
  ['standard-dark', 'wide', 'dark', 'miss-fortune', 'subtle'],
  ['standard-light', 'wide', 'light', 'miss-fortune', 'static'],
  ['standard-yasuo', 'wide', 'dark', 'yasuo', 'subtle'],
  ['standard-jinx', 'wide', 'dark', 'jinx', 'frames'],
  ['mini', 'compact', 'dark', 'miss-fortune', 'subtle']
];
for (const [name, layout, theme, background, motion] of variants) {
  const art = await inline(`assets/art/${background}.webp`, 'image/webp');
  const svg = renderCard(snapshot, { layout, theme, background, motion, art, font, championIcons, rankedEmblems, demo: true });
  await writeFile(path.join(directory, `${name}.svg`), svg.replace(/[ \t]+$/gm, ''));
}
await writeFile(path.join(directory, 'README.md'), '# 演示卡片\n\n这些卡片由 `pnpm examples` 使用脚本内明确构造的演示资料生成，不对应真实账号，不会进入应用的 `data/`。\n\n游戏素材权利及字体许可见仓库根目录 `THIRD_PARTY_NOTICES.md`。\n');
console.log(`已生成${variants.length}张演示卡片；未读取本地账号或战绩。`);
