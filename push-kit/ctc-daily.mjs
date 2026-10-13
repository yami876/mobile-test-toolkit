#!/usr/bin/env node
// CTC 数据每日推送到飞书群（群机器人 Webhook）
// 统计口径与工具站「CTC 数据查询」页面一致。两个任务各自配置 Webhook，可发到不同的群：
//   --job people    人员数据：每人用例新增/更新/执行、Bug 新增、回归关闭/失败
//   --job progress  版本进度：新增/待处理问题（含严重、高优、严重且高优）、回归情况、测试计划执行情况
//
// 用法：
//   node ctc-daily.mjs --job people   --slot morning   # 统计前一个工作日（中间隔着周末/假期的一并算进去）
//   node ctc-daily.mjs --job people   --slot evening   # 统计当天截至现在
//   node ctc-daily.mjs --job progress                  # 迭代中版本（提测单未完成）各统计当前轮次：进行中计划最早开始日 ~ 今天
//   --dry-run  只打印消息、不发送
//   --force    非工作日也执行（手动推送验证用）
//
// 配置：同目录 config.json；CTC 登录：优先用配置页「飞书登录」保存的凭证，其次 ctcmcpctl login 的凭证

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { currentToken } from './ctc-auth.mjs';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ACCURATE = 'https://accurate-server.makeblock.com';
const MFD = 'https://ctc-api.makeblock.com/mfd';
const CTC_WEB = 'https://ctc-next.makeblock.com';
const RELEASED = -1;
const UNRELEASED = -2;
const CLOSED = [6];
const VALID = [6, 1, 3, 5, 10003];
const PENDING = [1, 3, 10003];   // 待处理：新创建、处理中、挂起
const RESOLVED = [5];
const SEVERE = [10107, 10106];
const HIGH_PRIORITY = [1, 2];

const args = process.argv.slice(2);
const arg = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const job = arg('--job', 'people');
const slot = arg('--slot', 'morning');
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const config = JSON.parse(fs.readFileSync(path.join(DIR, 'config.json'), 'utf8'));
const jobConf = config[job];
if (!jobConf) {
  console.error(`config.json 里没有 ${job} 的配置`);
  process.exit(2);
}
const { projectId, pkey, projectName } = config.ctc || {};

function log(...a) {
  const line = `[${new Date().toLocaleString('zh-CN', { hour12: false })}] [${job}${job === 'people' ? '/' + slot : ''}] ${a.join(' ')}`;
  console.log(line);
  fs.appendFileSync(path.join(DIR, 'run.log'), line + '\n');
}

// ---------- CTC 登录 ----------
function getUtoken() {
  const t = currentToken();
  if (!t) throw new AuthError('找不到 CTC 登录信息');
  if (t.exp && t.exp * 1000 < Date.now()) throw new AuthError('CTC 登录已过期');
  return t.token;
}

class AuthError extends Error {}
let token;

async function request(base, p, { method = 'GET', body } = {}) {
  const resp = await fetch(base + p, {
    method,
    headers: { Accept: 'application/json', utoken: token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  if (resp.status === 401 || resp.status === 403) throw new AuthError(`HTTP ${resp.status}`);
  if (!resp.ok) throw new Error(`${method} ${p} -> HTTP ${resp.status} ${text.slice(0, 200)}`);
  const payload = JSON.parse(text);
  if (payload && payload.code !== 0 && payload.code != null) {
    if (payload.code === 10005) throw new AuthError(payload.msg);
    throw new Error(`${method} ${p} -> ${payload.code}: ${payload.msg}`);
  }
  return payload && 'data' in payload ? payload.data : payload;
}

// ---------- 日期 / 工作日（法定节假日 + 调休） ----------
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const md = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`;
const hm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const tsDate = (t) => ymd(new Date(t * 1000));
const holidayCache = {};
async function holidays(year) {
  if (!(year in holidayCache)) {
    try {
      const d = await (await fetch(`https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/${year}.json`)).json();
      holidayCache[year] = new Map((d.days || []).map((x) => [x.date, x.isOffDay]));
    } catch (e) {
      holidayCache[year] = new Map();   // 拿不到就按周一至周五
    }
  }
  return holidayCache[year];
}
async function isWorkday(d) {
  const special = (await holidays(d.getFullYear())).get(ymd(d));
  return special !== undefined ? !special : d.getDay() !== 0 && d.getDay() !== 6;
}
async function previousWorkday(d) {
  const x = new Date(d);
  do x.setDate(x.getDate() - 1); while (!(await isWorkday(x)));
  return x;
}

// ---------- CTC 查询 ----------
const verFilter = (v) => (v === 'all' ? undefined : [v]);
const VERSION_GROUP_LABEL = { all: '所有版本', [RELEASED]: '已发布版本', [UNRELEASED]: '未发布版本' };

function issueBody(f, pageSize = 1, pageIndex = 1) {
  const body = { project: [projectId], issueStatus: f.statuses, pageSize, pageIndex };
  if (f.versions) body.versions = f.versions;
  if (f.created) body.createdAt = f.created;
  if (f.updated) body.updatedAt = f.updated;
  if (f.severities) body.severity = f.severities;
  if (f.priorities) body.priority = f.priorities;
  if (f.regressFail) body.regressFail = 1;
  if (f.reporters) body.reporter = f.reporters;
  return body;
}
const issueCount = async (f) => (await request(ACCURATE, '/v1/issues/list', { method: 'POST', body: issueBody(f) })).count;
async function listIssues(f) {
  const all = [];
  for (let pageIndex = 1; pageIndex <= 20; pageIndex++) {
    const d = await request(ACCURATE, '/v1/issues/list', { method: 'POST', body: issueBody(f, 500, pageIndex) });
    all.push(...(d.list || []));
    if (!(d.list || []).length || all.length >= d.count) break;
  }
  return all;
}
function ctcListUrl(f) {
  const q = new URLSearchParams();
  (f.versions || []).forEach((v) => q.append('versions', v));
  (f.created || []).forEach((d) => q.append('createdAt', d));
  (f.updated || []).forEach((d) => q.append('updatedAt', d));
  f.statuses.forEach((s) => q.append('issueStatus', s));
  (f.severities || []).forEach((s) => q.append('severity', s));
  (f.priorities || []).forEach((s) => q.append('priority', s));
  if (f.regressFail) q.append('regressFail', 1);
  (f.reporters || []).forEach((u) => q.append('reporter', u));
  return `${CTC_WEB}/#/project/${pkey}/issue/list?${q}`;
}
const link = (n, f) => (n ? `[${n}](${ctcListUrl(f)})` : `${n}`);

let versionsCache;
async function versionOptions() {
  if (!versionsCache) {
    const tpl = await request(ACCURATE, `/v1/project/${projectId}/template?issueType=1`);
    const field = (tpl || []).find((f) => (f || {}).fieldKey === 'versions');
    const seen = new Set();
    versionsCache = ((field && field.CustomFieldOptions) || []).filter((v) => !seen.has(v.id) && seen.add(v.id));
  }
  return versionsCache;
}
async function versionName(v) {
  if (VERSION_GROUP_LABEL[v]) return VERSION_GROUP_LABEL[v];
  const hit = (await versionOptions()).find((x) => x.id === v);
  return hit ? hit.vname : `版本${v}`;
}
async function planVersionMatcher(v) {
  if (v === 'all') return () => true;
  if (v !== RELEASED && v !== UNRELEASED) return (pv) => pv === v;
  const released = new Set((await versionOptions()).filter((x) => x.released).map((x) => x.id));
  return v === RELEASED ? (pv) => released.has(pv) : (pv) => !released.has(pv);
}
const allPlans = async () => (await request(MFD, `/api/v1/test/plans?sysProjectId=${projectId}&page=1&size=1000`)).list || [];
async function loadPlanCases(planId) {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const d = await request(MFD, `/api/v1/test/plan/${planId}/related/case?page=${page}&size=1000`);
    all.push(...(d.list || []));
    if (!(d.list || []).length || all.length >= (d.total || 0)) break;
  }
  return all;
}

// ---------- 飞书 ----------
function card(title, elements, template = 'blue') {
  return { schema: '2.0', header: { title: { tag: 'plain_text', content: title }, template }, body: { elements } };
}
const mdEl = (content) => ({ tag: 'markdown', content });
const grey = (t) => mdEl(`<font color='grey'>${t}</font>`);
const button = (text, url) => ({ tag: 'button', text: { tag: 'plain_text', content: text }, type: 'default', behaviors: [{ type: 'open_url', default_url: url }] });

async function send(c) {
  if (dryRun) {
    console.log(JSON.stringify(c, null, 2));
    return;
  }
  if (!jobConf.webhook) throw new Error(`config.json 里 ${job}.webhook 还没配置`);
  const body = { msg_type: 'interactive', card: c };
  if (jobConf.secret) {   // 群机器人开启了「签名校验」时
    const timestamp = Math.floor(Date.now() / 1000);
    body.timestamp = String(timestamp);
    body.sign = crypto.createHmac('sha256', `${timestamp}\n${jobConf.secret}`).update('').digest('base64');
  }
  const res = await (await fetch(jobConf.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
  if (res.code !== 0 && res.StatusCode !== 0) throw new Error(`飞书推送失败：${JSON.stringify(res)}`);
}

// ========== 任务一：人员数据 ==========
async function peopleJob(today) {
  let start;
  let end;
  let title;
  if (slot === 'evening') {
    start = end = ymd(today);
    title = `📊 人员数据日报 · ${md(start)}（${catchUp && ymd(today) !== ymd(new Date()) ? '全天' : `截至 ${hm(new Date())}`}）`;
  } else {
    const prev = await previousWorkday(today);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    start = ymd(prev);
    end = ymd(yesterday);
    title = `📊 人员数据日报 · ${start === end ? md(start) : `${md(start)}～${md(end)}`}`;
  }
  const { version, regVersion, people } = jobConf;
  const from = new Date(start + 'T00:00:00').getTime() / 1000;
  const to = new Date(end + 'T23:59:59').getTime() / 1000;
  const ids = people.map((u) => u.id);
  const period = [start, end];
  const bugCols = {
    bugNew: { versions: verFilter(version), statuses: VALID, created: period },
    regClosed: { versions: verFilter(regVersion), statuses: CLOSED, updated: period },
    regFail: { versions: verFilter(regVersion), statuses: VALID, updated: period, regressFail: 1 },
  };
  const caseCount = async (field, timeField, userId) => (await request(MFD, '/api/v1/test/cases', {
    method: 'POST', body: { sysProjectId: projectId, page: 1, size: 1, [timeField]: [from, to], [field]: userId },
  })).total || 0;

  // 用例执行：周期内可能有执行的计划（已开始，且未结束或在周期开始后才结束）
  const inVersion = await planVersionMatcher(version);
  const active = (await allPlans()).filter((p) => {
    const s = p.actualStartTime || p.plannedStartTime;
    return inVersion(p.projectVersionId) && s && s <= to && (p.status !== 'Done' || (p.actualEndTime || 0) >= from);
  });
  const executed = new Map();
  for (const p of active) {
    (await loadPlanCases(p.id)).forEach((c) => {
      if (c.status === 'Prepare' || !ids.includes(c.executor) || c.updatedAt < from || c.updatedAt > to) return;
      executed.set(c.executor, (executed.get(c.executor) || 0) + 1);
    });
  }
  const bug = {};
  for (const [k, f] of Object.entries(bugCols)) {
    const m = new Map();
    (await listIssues({ ...f, reporters: ids })).forEach((i) => m.set(i.reporter, (m.get(i.reporter) || 0) + 1));
    bug[k] = m;
  }
  const rows = [];
  for (const u of people) {
    rows.push({
      ...u,
      caseNew: await caseCount('createBy', 'createdAt', u.id),
      caseUpdate: await caseCount('updateBy', 'updatedAt', u.id),
      caseExec: executed.get(u.id) || 0,
      bugNew: bug.bugNew.get(u.id) || 0, regClosed: bug.regClosed.get(u.id) || 0, regFail: bug.regFail.get(u.id) || 0,
    });
  }
  const COLS = [['caseNew', '用例新增'], ['caseUpdate', '用例更新'], ['caseExec', '用例执行'], ['bugNew', 'Bug新增'], ['regClosed', '回归关闭'], ['regFail', '回归失败']];
  const total = Object.fromEntries(COLS.map(([k]) => [k, rows.reduce((s, r) => s + r[k], 0)]));
  const line = (r, who) => `**${r.name}**：` + COLS.map(([k, label]) =>
    `${label} ${bugCols[k] ? link(r[k], { ...bugCols[k], reporters: who }) : r[k]}`).join(' ｜ ');
  return card(title + (catchUp ? '（补推）' : ''), [
    mdEl(`**统计周期**：${start === end ? md(start) : `${md(start)}～${md(end)}`}　**项目**：${projectName}　**版本**：${await versionName(version)}　**回归统计**：${await versionName(regVersion)}`),
    { tag: 'hr' },
    mdEl(rows.map((r) => line(r, [r.id])).join('\n')),
    { tag: 'hr' },
    mdEl(line({ name: '合计', ...total }, ids)),
    grey(`Bug 数字可点开到 CTC；用例数据按整个项目统计。数据时间 ${new Date().toLocaleString('zh-CN', { hour12: false })}`),
    button('打开人员数据页面', jobConf.pageUrl),
  ]);
}

// ========== 任务二：版本进度 ==========
// 测试计划时间：开始取实际开始（没有则计划开始）；结束取实际结束，没结束的取计划结束，都没有则只看开始那天
function planSpan(p) {
  const s = p.actualStartTime || p.plannedStartTime;
  if (!s) return null;
  return { s, e: p.actualEndTime || Math.max(p.PlannedEndTime || 0, s) };
}
const PLAN_STATUS = { Prepare: '未开始', Underway: '进行中', Done: '已完成' };
const pct = (a, b) => {
  if (!b) return '—';
  const t = ((a * 100) / b).toFixed(1);
  return (t.endsWith('.0') ? t.slice(0, -2) : t) + '%';
};

// 当前迭代中的版本：提测单状态不是「已完成」（等待提测 / 测试审核 / 测试打回 / 测试中），按版本名对应到缺陷平台的版本
const ITERATING_STATUS = ['wait_record', 'tester_check', 'tester_back', 'testing'];
async function iteratingVersions() {
  const names = [];
  for (const st of ITERATING_STATUS) {
    const d = await request(MFD, `/api/v1/version/list?project=${projectId}&page=1&size=100&status=${st}`);
    (d.list || []).forEach((r) => { if (!names.includes(r.name)) names.push(r.name); });
  }
  const options = await versionOptions();
  const found = [];
  const missing = [];
  const exclude = jobConf.exclude || [];
  names.filter((n) => !exclude.includes(n)).forEach((n) => {
    const v = options.find((o) => o.vname === n);
    if (v) found.push(v.id);
    else missing.push(n);
  });
  return { found, missing };
}

async function progressJob(today) {
  const conf = jobConf.version;
  if (conf === null || conf === undefined || conf === '') throw new Error('config.json 里 progress.version 还没配置');
  let versions;
  let missing = [];
  if (conf === 'iterating') ({ found: versions, missing } = await iteratingVersions());
  else versions = Array.isArray(conf) ? conf : [conf];
  const plansAll = await allPlans();
  const elements = [];
  for (const vid of versions) {
    elements.push(...await progressSection(vid, today, plansAll), { tag: 'hr' });
  }
  if (!versions.length) elements.push(mdEl('当前没有迭代中的版本（提测单都已完成）'), { tag: 'hr' });
  if (missing.length) elements.push(grey(`提测单里这些版本在缺陷平台找不到同名版本，未统计：${missing.join('、')}`));
  elements.push(
    grey(`数字可点开到 CTC 核对；人员明细、未执行用例模块请在页面查看。数据时间 ${new Date().toLocaleString('zh-CN', { hour12: false })}`),
    button('打开版本进度页面', jobConf.pageUrl),
  );
  const title = conf === 'iterating'
    ? `🚦 版本进度 · ${md(ymd(today))}（${versions.length} 个迭代中版本）`
    : `🚦 版本进度 · ${md(ymd(today))}`;
  return card(title + (catchUp ? '（补推）' : ''), elements);
}

// 单个版本的进度段落
async function progressSection(vid, today, plansAll) {
  const vname = await versionName(vid);
  const reg = jobConf.regVersion === 'same' || jobConf.regVersion == null ? vid : jobConf.regVersion;
  const inVersion = await planVersionMatcher(vid);
  const plans = plansAll.filter((p) => inVersion(p.projectVersionId));

  // 当前轮次：进行中计划里最早的开始日 ~ 今天；没有进行中的计划就取最近一个开始的计划
  const underway = plans.filter((p) => p.status === 'Underway' && (p.actualStartTime || p.plannedStartTime));
  const startsOf = (list) => list.map((p) => p.actualStartTime || p.plannedStartTime).filter(Boolean);
  const startTs = underway.length ? Math.min(...startsOf(underway)) : Math.max(0, ...startsOf(plans));
  const start = startTs ? tsDate(startTs) : ymd(today);
  const end = ymd(today);
  const period = [start, end];
  const from = new Date(start + 'T00:00:00').getTime() / 1000;
  const to = new Date(end + 'T23:59:59').getTime() / 1000;
  const dayBefore = (() => { const d = new Date(start + 'T00:00:00'); d.setDate(d.getDate() - 1); return ymd(d); })();

  const block = async (base, withList = true) => {
    const sub = {
      total: base,
      severe: { ...base, severities: SEVERE },
      high: { ...base, priorities: HIGH_PRIORITY },
      critical: { ...base, severities: SEVERE, priorities: HIGH_PRIORITY },
    };
    const out = {};
    for (const [k, f] of Object.entries(sub)) out[k] = { f, n: await issueCount(f) };
    out.critical.issues = withList && out.critical.n ? (await request(ACCURATE, '/v1/issues/list', { method: 'POST', body: issueBody(out.critical.f, 50) })).list || [] : [];
    return out;
  };
  const created = await block({ versions: verFilter(vid), statuses: VALID, created: period }, false);
  const pending = await block({ versions: verFilter(vid), statuses: PENDING });
  const regF = {
    closed: { versions: verFilter(reg), statuses: CLOSED, updated: period },
    reopened: { versions: verFilter(reg), statuses: VALID, updated: period, regressFail: 1 },
    remain: { versions: verFilter(reg), statuses: RESOLVED, updated: ['2000-01-01', dayBefore] },
  };
  const regN = {};
  for (const [k, f] of Object.entries(regF)) regN[k] = await issueCount(f);

  const periodPlans = plans.filter((p) => {
    const span = planSpan(p);
    return span && span.s <= to && span.e >= from;
  });
  const planLines = [];
  for (const p of periodPlans) {
    const st = await request(MFD, `/api/v1/test/plan/${p.id}/statistics`).catch(() => null);
    const url = `${CTC_WEB}/#/project/${pkey}/dev/test-plan/test-plan-detail/${projectId}/${p.projectVersionId}/${p.id}`;
    if (!st) {
      planLines.push(`- [${p.name}](${url})（${PLAN_STATUS[p.status] || p.status}）：统计获取失败`);
      continue;
    }
    const executed = st.total - (st.prepare || 0);
    planLines.push(`- [${p.name}](${url})（${PLAN_STATUS[p.status] || p.status}）：用例 ${st.total}，通过 ${st.pass}，`
      + `失败 ${st.fail ? `<font color='red'>${st.fail}</font>` : 0}，阻塞 ${st.block}，未执行 ${st.prepare}，`
      + `**执行率 ${pct(executed, st.total)}**，**通过率 ${pct(st.pass, executed)}**`);
  }

  const issueLine = (label, b) => `**${label}**：${link(b.total.n, b.total.f)}（严重 ${link(b.severe.n, b.severe.f)}，高优 ${link(b.high.n, b.high.f)}，`
    + `严重且高优 ${b.critical.n ? `<font color='red'>${link(b.critical.n, b.critical.f)}</font>` : 0}）`;
  // 推送只逐条列「当前待处理」里的严重且高优（真正要盯的），最多 10 条
  const CRITICAL_MAX = 10;
  const criticalList = (b) => [
    ...b.critical.issues.slice(0, CRITICAL_MAX).map((i) => {
      const key = `${i.pkey || pkey}-${i.issueNum}`;
      return `　· [${key}](${CTC_WEB}/#/issue/detail/${key}) ${i.summary}（${i.issueStatusName}，经办人：${i.assigneeName || '未指派'}）`;
    }),
    ...(b.critical.n > CRITICAL_MAX ? [`　· 等共 ${link(b.critical.n, b.critical.f)} 条`] : []),
  ];
  const regLabel = reg === vid ? '' : `（回归统计：${await versionName(reg)}）`;
  return [
    mdEl(`### ${vname}\n<font color='grey'>${projectName} · 本轮 ${md(start)}～${md(end)}${regLabel}</font>`),
    mdEl([
      issueLine('本轮新增问题', created),
      issueLine('当前待处理问题', pending), ...criticalList(pending),
      `**回归关闭**：${link(regN.closed, regF.closed)}　**回归失败**：${link(regN.reopened, regF.reopened)}　**剩余回归（待回归）**：${link(regN.remain, regF.remain)}`,
      `**测试计划**（${periodPlans.length} 个）` + (planLines.length ? '\n' + planLines.join('\n') : '：本轮没有测试计划'),
    ].join('\n')),
  ];
}

// 配置页用：列出当前迭代中的版本名（不发送任何消息）
if (args.includes('--list-iterating')) {
  token = getUtoken();
  const names = [];
  for (const st of ITERATING_STATUS) {
    const d = await request(MFD, `/api/v1/version/list?project=${projectId}&page=1&size=100&status=${st}`);
    (d.list || []).forEach((r) => { if (!names.includes(r.name)) names.push(r.name); });
  }
  console.log(JSON.stringify(names));
  process.exit(0);
}

// ---------- 主流程 ----------
// 定时任务会传 --at 计划时间。到点时电脑关机 / 睡眠，开机后才补跑，
// 这时要按原计划那天统计：计划时间比现在晚，说明补的是前一天（或更早）那次
function plannedRun() {
  const now = new Date();
  const m = /^(\d{1,2}):(\d{2})$/.exec(arg('--at', ''));
  if (!m) return { today: now, catchUp: false };
  const planned = new Date(now.getFullYear(), now.getMonth(), now.getDate(), Number(m[1]), Number(m[2]));
  if (planned > now) planned.setDate(planned.getDate() - 1);
  return { today: planned, catchUp: now - planned > 15 * 60 * 1000 };   // 晚了 15 分钟以上算补推
}
const { today, catchUp } = plannedRun();
if (catchUp) log(`补推：原计划 ${today.toLocaleString('zh-CN', { hour12: false })}`);
try {
  if (!force && jobConf.enabled === false) {
    log('已在配置里停用，跳过');
    process.exit(0);
  }
  if (!force && !(await isWorkday(today))) {
    log(`今天 ${ymd(today)} 不是工作日，跳过`);
    process.exit(0);
  }
  if (!projectId) throw new Error('还没有选择项目，请打开「CTC 推送配置」页面选择项目');
  token = getUtoken();
  const c = job === 'progress' ? await progressJob(today) : await peopleJob(today);
  await send(c);
  log(`推送${dryRun ? '（dry-run，未发送）' : ''}成功`);
} catch (e) {
  log(`失败：${e.message}`);
  const name = job === 'progress' ? '版本进度' : '人员数据';
  const alert = e instanceof AuthError
    ? card(`⚠️ CTC 登录已过期，${name}未推送`, [mdEl('请在电脑上打开「推送配置」页面点 **飞书登录**（或执行 `ctcmcpctl login`），下次定时任务会自动恢复推送。')], 'red')
    : card(`⚠️ ${name}推送失败`, [mdEl(`错误信息：${e.message}`)], 'red');
  try { await send(alert); } catch (e2) { log('告警发送也失败：' + e2.message); }
  process.exit(1);
}
