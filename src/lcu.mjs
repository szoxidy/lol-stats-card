import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { CardError } from './model.mjs';

const run = promisify(execFile);
const allowed = /^\/(?:lol-summoner\/v1\/current-summoner(?:\/summoner-profile)?|lol-regalia\/v2\/current-summoner\/regalia|lol-challenges\/v1\/summary-player-data\/local-player|lol-ranked\/v1\/current-ranked-stats|riotclient\/region-locale|lol-match-history\/v1\/products\/lol\/[A-Za-z0-9_-]+\/matches\?begIndex=0&endIndex=19|lol-game-data\/assets\/v1\/(?:profile-icons|champion-icons)\/\d+\.(?:jpg|png))$/;

export function parseLockfile(content) {
  const fields = content.trim().split(':');
  const port = Number(fields[2]);
  if (fields.length !== 5 || !fields[3] || !Number.isInteger(port) || port < 1 || port > 65535 || fields[4] !== 'https') throw new CardError('LOCKFILE_INVALID', '客户端连接文件格式无效。');
  return { port, password: fields[3], pid: Number(fields[1]), region: '' };
}

export function parseCommandLine(commandLine, pid) {
  const flag = name => new RegExp(`--${name}=(?:"([^"]+)"|([^\\s"]+))`).exec(commandLine)?.slice(1).find(Boolean);
  const port = Number(flag('app-port'));
  const password = flag('remoting-auth-token');
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !password) return null;
  return { port, password, pid, region: flag('rso[_-]platform[_-]id') || flag('region') || '' };
}

export function selectClientProcess(processes, configuredPid) {
  const ui = processes.filter(process => process.Name === 'LeagueClientUx.exe');
  const candidates = configuredPid
    ? processes.filter(process => String(process.ProcessId) === String(configuredPid))
    : ui.length ? ui : processes.filter(process => process.Name === 'LeagueClient.exe');
  if (!candidates.length) throw new CardError(configuredPid ? 'CLIENT_PID_NOT_FOUND' : 'CLIENT_NOT_RUNNING', configuredPid ? '指定的客户端进程已不存在，请检查 LOL_CLIENT_PID。' : '未检测到英雄联盟后台客户端。');
  if (candidates.length > 1) throw new CardError('MULTIPLE_CLIENTS', '检测到多个客户端，请用 LOL_CLIENT_PID 指定本次账号对应的进程。');
  return candidates[0];
}

export async function discoverClient(env = process.env) {
  if (env.LOL_LOCKFILE) {
    try { return parseLockfile(await readFile(path.resolve(env.LOL_LOCKFILE), 'utf8')); }
    catch (error) { if (error instanceof CardError) throw error; throw new CardError('LOCKFILE_UNREADABLE', '读不到指定的客户端连接文件，请检查 LOL_LOCKFILE。'); }
  }
  if (process.platform !== 'win32') throw new CardError('PLATFORM_UNSUPPORTED', '自动发现目前适用于 Windows；其他系统请指定 LOL_LOCKFILE。');
  let processes;
  try {
    // 输出只进入当前进程内存，绝不打印、持久化或写入日志。
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); @(Get-CimInstance Win32_Process -Filter \"Name='LeagueClientUx.exe' OR Name='LeagueClient.exe'\" -ErrorAction Stop | Select-Object Name,ProcessId,ExecutablePath,CommandLine) | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 12000, maxBuffer: 512 * 1024, encoding: 'utf8' });
    const result = stdout.trim() ? JSON.parse(stdout) : [];
    processes = Array.isArray(result) ? result : [result];
  } catch { throw new CardError('DISCOVERY_FAILED', '无法读取客户端进程信息；可以通过 LOL_LOCKFILE 指定游戏目录下的 lockfile。'); }
  const processInfo = selectClientProcess(processes, env.LOL_CLIENT_PID);
  const direct = parseCommandLine(processInfo.CommandLine || '', processInfo.ProcessId);
  if (direct) return direct;
  if (processInfo.ExecutablePath) {
    const directory = path.dirname(processInfo.ExecutablePath);
    for (const file of [path.join(directory, 'lockfile'), path.join(directory, '..', 'lockfile')]) {
      try { return parseLockfile(await readFile(file, 'utf8')); } catch { /* 尝试下一处已知游戏目录 */ }
    }
  }
  throw new CardError('CLIENT_AUTH_UNAVAILABLE', '已找到客户端，但连接信息不可读或尚未生成。请让取数工具与游戏使用相同权限，或指定有效的 LOL_LOCKFILE。');
}

export function createLcuClient(connection) {
  return async function get(endpoint, binary = false) {
    if (!allowed.test(endpoint)) throw new CardError('ENDPOINT_FORBIDDEN', '请求不在只读取数范围内。');
    return new Promise((resolve, reject) => {
      const req = https.request({
        hostname: '127.0.0.1', port: connection.port, method: 'GET', path: endpoint,
        // 仅对此固定回环地址允许客户端自签名证书，不改变全局 TLS 设置。
        rejectUnauthorized: false,
        headers: { Authorization: `Basic ${Buffer.from(`riot:${connection.password}`).toString('base64')}`, Accept: binary ? 'image/*' : 'application/json' }
      }, response => {
        const chunks = []; let size = 0;
        response.on('data', chunk => {
          size += chunk.length;
          if (size > (binary ? 128 * 1024 : 6 * 1024 * 1024)) { response.destroy(); reject(new CardError('LCU_RESPONSE_TOO_LARGE', '客户端返回的数据过大，本次未保存。')); return; }
          chunks.push(chunk);
        });
        response.on('error', () => reject(new CardError('LCU_RESPONSE_ERROR', '客户端响应中断，请稍后重新同步。')));
        response.on('end', () => {
          if (response.statusCode !== 200) { reject(new CardError('LCU_UNAVAILABLE', `客户端暂未提供所需数据（HTTP ${response.statusCode}）。`)); return; }
          const body = Buffer.concat(chunks);
          if (binary) {
            const png = body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
            const jpg = body[0] === 255 && body[1] === 216;
            if (!png && !jpg) { reject(new CardError('ICON_INVALID', '客户端图标格式无效。')); return; }
            resolve(`data:image/${png ? 'png' : 'jpeg'};base64,${body.toString('base64')}`);
          } else {
            try { resolve(JSON.parse(body.toString('utf8'))); }
            catch { reject(new CardError('LCU_INVALID_JSON', '客户端暂未返回有效数据。')); }
          }
        });
      });
      req.setTimeout(7000, () => req.destroy());
      req.on('error', () => reject(new CardError('LCU_CONNECTION_FAILED', '连接本机客户端失败，请确认已完成登录。')));
      req.end();
    });
  };
}
