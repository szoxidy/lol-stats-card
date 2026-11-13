import { readFile } from 'node:fs/promises';
import { CardError, validateSnapshot } from './model.mjs';

export async function publishSnapshot(snapshot, { targets, env = process.env, request = fetch } = {}) {
  if (!targets) {
    if (!env.LOL_CARD_TARGETS_FILE) return [];
    try { targets = JSON.parse(await readFile(env.LOL_CARD_TARGETS_FILE, 'utf8')); }
    catch { throw new CardError('TARGETS_INVALID', '国内/国外同步配置无法读取，本地数据已保留。'); }
  }
  if (!Array.isArray(targets) || targets.length > 8) throw new CardError('TARGETS_INVALID', '同步目标配置格式无效。');
  const body = JSON.stringify(validateSnapshot(snapshot));
  // 各站并发、各自超时；一端失败不取消另一端，返回结果不包含 URL 或认证头。
  return Promise.all(targets.map(async (target, index) => {
    const name = typeof target.name === 'string' ? target.name.slice(0, 20) : `站点 ${index + 1}`;
    let url;
    try { url = new URL(target.url); } catch { return { name, ok: false, code: 'INVALID_URL' }; }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['/api/snapshot', '/lol-card/api/snapshot'].includes(url.pathname)) return { name, ok: false, code: 'INVALID_URL' };
    const token = /^[A-Z][A-Z0-9_]+$/.test(target.tokenEnv || '') ? env[target.tokenEnv] : null;
    if (!token || token.length < 32) return { name, ok: false, code: 'TOKEN_MISSING' };
    try {
      const response = await request(url, { method: 'PUT', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body, signal: AbortSignal.timeout(12000) });
      return { name, ok: response.ok, code: response.ok ? 'SYNCED' : `HTTP_${response.status}` };
    } catch { return { name, ok: false, code: 'UPLOAD_FAILED' }; }
  }));
}
