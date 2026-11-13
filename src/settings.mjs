import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function readPlayerConfig(file = path.join(root, 'config/player.json')) {
  let contents;
  try { contents = await readFile(file, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    contents = await readFile(path.join(root, 'config/player.example.json'), 'utf8');
  }
  return JSON.parse(contents);
}
