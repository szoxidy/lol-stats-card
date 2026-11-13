import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const dir of ['src', 'public', 'scripts', 'test']) {
  for (const file of await readdir(path.join(root, dir))) {
    if (file.endsWith('.mjs') || file.endsWith('.js')) execFileSync(process.execPath, ['--check', path.join(root, dir, file)], { stdio: 'pipe' });
  }
}
console.log('源码语法检查通过。');
