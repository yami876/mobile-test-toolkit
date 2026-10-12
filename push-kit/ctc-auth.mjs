// CTC 登录凭证：优先用配置页「飞书登录」保存的 token.json，其次用 ctcmcpctl login 写入的 Claude Code 配置
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
export const TOKEN_FILE = path.join(DIR, 'token.json');
const CTC_MCP = 'https://ctc-mcp.makeblock.com';

export const normalize = (t) => (t && !/^Bearer\s/i.test(t) ? 'Bearer ' + t : t);

// JWT 里的过期时间（秒），解析不了返回 null
export function tokenExp(token) {
  try {
    const part = token.replace(/^Bearer\s+/i, '').split('.')[1];
    return JSON.parse(Buffer.from(part, 'base64url').toString()).exp || null;
  } catch (e) {
    return null;
  }
}

function fromLoginFile() {
  try {
    const t = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')).utoken;
    return t ? { token: normalize(t), source: '配置页飞书登录' } : null;
  } catch (e) {
    return null;
  }
}

function fromCtcmcpctl() {
  for (const f of [path.join(os.homedir(), '.claude.json'), path.join(os.homedir(), '.config', 'claude-code', 'config.json')]) {
    try {
      const url = (((JSON.parse(fs.readFileSync(f, 'utf8')).mcpServers || {}).ctc || {}).url) || '';
      const t = new URL(url || 'http://x').searchParams.get('utoken');
      if (t) return { token: normalize(t), source: 'ctcmcpctl login' };
    } catch (e) { /* 文件不存在或格式不对，看下一个 */ }
  }
  return null;
}

// 返回 { token, source, exp }；两个来源都有时取过期时间更晚的那个
export function currentToken() {
  if (process.env.CTC_UTOKEN) return { token: normalize(process.env.CTC_UTOKEN), source: '环境变量', exp: tokenExp(process.env.CTC_UTOKEN) };
  const list = [fromLoginFile(), fromCtcmcpctl()].filter(Boolean).map((x) => ({ ...x, exp: tokenExp(x.token) }));
  if (!list.length) return null;
  list.sort((a, b) => (b.exp || 0) - (a.exp || 0));
  return list[0];
}

export function saveLoginToken(token) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify({ utoken: normalize(token), savedAt: new Date().toISOString() }, null, 2), 'utf8');
}

// ---- 飞书登录（与 ctcmcpctl login 同一套流程）----
export async function loginStart() {
  const r = await fetch(CTC_MCP + '/client/browser/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  if (!r.ok) throw new Error('发起登录失败 HTTP ' + r.status);
  return r.json();   // { request_id, verify_url, expires_at }
}

export async function loginPoll(rid) {
  const r = await fetch(`${CTC_MCP}/client/browser/poll?request_id=${encodeURIComponent(rid)}`);
  if (r.status === 404) return { status: 'expired' };
  const d = await r.json();
  if (d.status === 'pending') return { status: 'pending' };
  const token = d.accurate_utoken || d.workspace_token || d.workspace_utoken;
  if (!token) return { status: d.status || 'failed' };
  // 确认能访问 CTC 再保存
  const check = await fetch('https://accurate-server.makeblock.com/v1/allProjects', { headers: { utoken: normalize(token) } });
  if (!check.ok) return { status: 'invalid' };
  saveLoginToken(token);
  return { status: 'ok' };
}
