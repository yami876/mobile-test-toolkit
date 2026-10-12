#!/usr/bin/env node
// 推送配置页的本地服务：只监听 127.0.0.1，读写 config.json、预览 / 立即推送、管理 Windows 定时任务
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { currentToken, loginStart, loginPoll } from './ctc-auth.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.CTC_DAILY_PORT) || 8766;   // 环境变量只在测试时用
const NODE = process.execPath;
const CONFIG = path.join(DIR, 'config.json');
const TASK_PATH = '\\CTCDaily\\';
// 只管理工作目录是本安装目录的任务：同一台电脑装了多份（比如测试）时互不影响
// 任务名带上安装目录的短标识，避免多份安装同名冲突
const TAG = crypto.createHash('md5').update(DIR.toLowerCase()).digest('hex').slice(0, 6);
const MINE = `Where-Object { $_.Actions[0].WorkingDirectory -eq ${"'" + DIR.replace(/'/g, "''") + "'"} }`;
const KIT_VERSION = (() => { try { return fs.readFileSync(path.join(DIR, 'version.txt'), 'utf8').trim(); } catch (e) { return 'dev'; } })();

const readConfig = () => JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
const writeConfig = (c) => fs.writeFileSync(CONFIG, JSON.stringify(c, null, 2), 'utf8');

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd: DIR, windowsHide: true, ...opts });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
}
const powershell = (script) => run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
  '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' + script]);

// ---------- CTC（人员、项目列表） ----------
function token() {
  const t = currentToken();
  if (!t) throw new Error('还没有 CTC 登录信息，请先点页面上的「飞书登录」');
  if (t.exp && t.exp * 1000 < Date.now()) throw new Error('CTC 登录已过期，请点页面上的「飞书登录」');
  return t.token;
}
async function mfd(p) {
  const r = await fetch('https://ctc-api.makeblock.com/mfd/api/v1' + p, { headers: { utoken: token() } });
  const j = await r.json();
  if (j.code !== 0) throw new Error(`CTC 接口失败：${j.msg || r.status}`);
  return j.data;
}
let usersCache = null;
async function users() {
  // 只保留 ID 和姓名，手机号、邮箱等不往页面上发
  if (!usersCache) usersCache = (await mfd('/users')).map((u) => ({ id: u.id, name: u.realName || u.userName, account: u.userName }));
  return usersCache;
}
// 项目列表：我的项目在前，其余按 CTC 原顺序
async function projects() {
  const [all, mine] = await Promise.all([mfd('/allSysProjects'), mfd('/userSysProjects').catch(() => [])]);
  const mineIds = new Set((mine || []).map((p) => p.id));
  const item = (p) => ({ id: p.id, name: p.name, code: p.code || '', pkey: p.pkey, mine: mineIds.has(p.id) });
  return [...all.filter((p) => mineIds.has(p.id)).map(item), ...all.filter((p) => !mineIds.has(p.id)).map(item)];
}
function loginStatus() {
  const t = currentToken();
  if (!t) return { loggedIn: false };
  return { loggedIn: true, source: t.source, exp: t.exp, expired: !!(t.exp && t.exp * 1000 < Date.now()) };
}

// ---------- 定时任务 ----------
function taskList(config) {
  const tasks = [];
  if (config.people.enabled !== false) {
    (config.people.schedule || []).forEach((s) => tasks.push({
      name: `people-${s.time.replace(':', '')}-${s.slot}-${TAG}`, time: s.time, args: `ctc-daily.mjs --job people --slot ${s.slot}`,
      desc: `人员数据（${s.slot === 'evening' ? '当天' : '前一个工作日'}）`,
    }));
  }
  if (config.progress.enabled !== false) {
    (config.progress.schedule || []).forEach((s) => tasks.push({
      name: `progress-${s.time.replace(':', '')}-${TAG}`, time: s.time, args: 'ctc-daily.mjs --job progress', desc: '版本进度',
    }));
  }
  return tasks;
}
const psq = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function applySchedule() {
  const tasks = taskList(readConfig());
  const lines = [
    `Get-ScheduledTask -TaskPath ${psq(TASK_PATH)} -ErrorAction SilentlyContinue | ${MINE} | Unregister-ScheduledTask -Confirm:$false`,
    ...tasks.map((t) => [
      `$a = New-ScheduledTaskAction -Execute ${psq(NODE)} -Argument ${psq(t.args)} -WorkingDirectory ${psq(DIR)}`,
      `$t = New-ScheduledTaskTrigger -Daily -At ${psq(t.time)}`,
      `$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 30)`,
      `Register-ScheduledTask -TaskPath ${psq(TASK_PATH)} -TaskName ${psq(t.name)} -Action $a -Trigger $t -Settings $s -Description ${psq('CTC 数据推送：' + t.desc + '（非工作日脚本自动跳过）')} | Out-Null`,
    ].join('; ')),
    'Write-Output "OK"',
  ];
  const r = await powershell(lines.join('; '));
  if (!r.out.includes('OK')) throw new Error('创建定时任务失败：' + r.out.slice(0, 500));
  return scheduleStatus();
}

async function scheduleStatus() {
  const r = await powershell(`$x = Get-ScheduledTask -TaskPath ${psq(TASK_PATH)} -ErrorAction SilentlyContinue | ${MINE} | ForEach-Object {
    $i = $_ | Get-ScheduledTaskInfo
    [pscustomobject]@{ name = $_.TaskName; state = [string]$_.State; next = if ($i.NextRunTime) { $i.NextRunTime.ToString('yyyy-MM-dd HH:mm') } else { '' };
      last = if ($i.LastRunTime -and $i.LastRunTime.Year -gt 2000) { $i.LastRunTime.ToString('yyyy-MM-dd HH:mm') } else { '' }; result = $i.LastTaskResult;
      args = $_.Actions[0].Arguments }
  }; if ($x) { ConvertTo-Json @($x) -Compress } else { '[]' }`);
  try { return JSON.parse(r.out.trim() || '[]'); } catch (e) { return []; }
}

// ---------- HTTP ----------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}
const readBody = (req) => new Promise((resolve) => {
  let b = '';
  req.on('data', (d) => { b += d; });
  req.on('end', () => resolve(b ? JSON.parse(b) : {}));
});

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    // 工具站页面用来探测配置页是否在运行：只开放这一个跨域接口，配置相关接口不对外
    if (url.pathname === '/api/ping') {
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Allow-Methods': 'GET',
        'Content-Type': 'application/json',
      });
      return res.end(req.method === 'OPTIONS' ? '' : '{"ok":true}');
    }
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, fs.readFileSync(path.join(DIR, 'config.html'), 'utf8'), 'text/html; charset=utf-8');
    }
    if (url.pathname === '/api/config' && req.method === 'GET') return send(res, 200, readConfig());
    if (url.pathname === '/api/config' && req.method === 'POST') {
      writeConfig(await readBody(req));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/users') return send(res, 200, await users());
    if (url.pathname === '/api/projects') return send(res, 200, await projects());
    if (url.pathname === '/api/login/status') return send(res, 200, loginStatus());
    if (url.pathname === '/api/login/start' && req.method === 'POST') return send(res, 200, await loginStart());
    if (url.pathname === '/api/login/poll') {
      const r = await loginPoll(url.searchParams.get('rid'));
      if (r.status === 'ok') usersCache = null;   // 换了登录，用户列表重新拉
      return send(res, 200, r);
    }
    if (url.pathname === '/api/version') return send(res, 200, { version: KIT_VERSION });
    if (url.pathname === '/api/iterating') {
      if (!(readConfig().ctc || {}).projectId) return send(res, 200, []);
      const r = await run(NODE, ['ctc-daily.mjs', '--job', 'progress', '--list-iterating']);
      return send(res, 200, JSON.parse(r.out.trim().split('\n').pop()));
    }
    if (url.pathname === '/api/run' && req.method === 'POST') {
      const { job, slot, dryRun } = await readBody(req);
      const args = ['ctc-daily.mjs', '--job', job, '--force'];
      if (job === 'people') args.push('--slot', slot || 'morning');
      if (dryRun) args.push('--dry-run');
      const r = await run(NODE, args);
      let card = null;
      if (dryRun) {
        const i = r.out.indexOf('{');
        const j = r.out.lastIndexOf('}');
        try { card = JSON.parse(r.out.slice(i, j + 1)); } catch (e) { /* 没有卡片说明出错了 */ }
      }
      const logLine = r.out.trim().split('\n').filter((l) => l.startsWith('[')).pop() || r.out.slice(-300);
      return send(res, 200, { ok: r.code === 0, log: logLine, card });
    }
    if (url.pathname === '/api/schedule' && req.method === 'GET') return send(res, 200, await scheduleStatus());
    if (url.pathname === '/api/schedule' && req.method === 'POST') return send(res, 200, await applySchedule());
    if (url.pathname === '/api/log') {
      const f = path.join(DIR, 'run.log');
      const lines = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : [];
      return send(res, 200, lines.slice(-100).reverse());
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    send(res, 500, { error: e.message });
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`推送配置页已启动：http://127.0.0.1:${PORT}`);
  console.log('关闭这个窗口即可停止配置页（不影响定时推送）');
});
