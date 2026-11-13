import { execFileSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
if (!files.length) throw new Error('没有可核对的已跟踪文件。');
const forbiddenPaths = /^(?:data\/|output\/|node_modules\/|\.env(?:\.|$)|config\/(?:player|targets)\.json$|AGENTS\.md$|docs\/progress\.md$)/;
const secrets = /\b(?:gh[pousr]_[a-zA-Z0-9]{24,}|github_pat_[a-zA-Z0-9_]{30,}|sk-[a-zA-Z0-9]{24,})\b/;
let privateName;
try { privateName = JSON.parse(await readFile(path.join(root, 'config/player.json'), 'utf8')).name; }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const problems = [];
let bytes = 0;
for (const file of files) {
  if (forbiddenPaths.test(file)) problems.push(`${file}: 私人路径不得发布`);
  const fullPath = path.join(root, file);
  bytes += (await stat(fullPath)).size;
  if (!/\.(?:m?js|json|md|ya?ml|svg|html|css|txt)$/.test(file)) continue;
  const text = await readFile(fullPath, 'utf8');
  if (secrets.test(text)) problems.push(`${file}: 检测到疑似凭据`);
  if (privateName && privateName !== '召唤师' && text.includes(privateName)) problems.push(`${file}: 包含本地账号名称`);
}
if (problems.length) throw new Error(problems.join('\n'));
console.log(JSON.stringify({ files: files.length, bytes, privatePaths: 0, credentialMatches: 0, privateAccountMatches: 0 }));
