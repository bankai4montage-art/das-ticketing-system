#!/usr/bin/env node
/**
 * E2E: اللايف أبديت + إشعارات المندوب الذكية
 *
 * بيشغّل نسخة سيرفر مستقلة على قاعدة مؤقتة (RAILWAY_VOLUME_MOUNT_PATH) عشان
 * ما يلمسش database.db بتاع التطوير، وبيتحقق من:
 *   - /api/events long-poll بيرجع أحداث التعديلات لحظة حدوثها (تحديث شكوى، سلفة، قبض، كروت، حضور)
 *   - تنبيه المندوب بيتسجل في جرسه مرة واحدة لكل مرجع (الدمج) وبيتحسب كغير مقروء
 *   - التعليم كمقروء + العداد بيرجع صفر
 *   - reset لو العميل جاي من سيرفر تاني/restart (rev أعلى)
 *   - الرفض اللحظي (wait=0) والمهلة (wait) شكلهم صح
 *
 * التشغيل: node test/live_events_e2e.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.env.TEST_PORT || '8905';
const BASE = `http://localhost:${PORT}`;
const ADMIN_PASS = 'live-test-pass-123';

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ✘ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(pathname, opts = {}) {
  const res = await fetch(BASE + pathname, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* مش JSON */ }
  return { status: res.status, data };
}
const j = (method, body, headers = {}) => ({
  method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
});

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'das-live-'));
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, PORT, RAILWAY_VOLUME_MOUNT_PATH: tmpDir, ADMIN_PASS, NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
child.stdout.on('data', (d) => { serverLog += d; });
child.stderr.on('data', (d) => { serverLog += d; });

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/version'); if (r.ok) return true; } catch (e) {}
    await sleep(250);
  }
  return false;
}

function longPoll(since, wait = 10) {
  const started = Date.now();
  return fetch(`${BASE}/api/events?since=${since}&wait=${wait}`)
    .then((r) => r.json())
    .then((data) => ({ data, ms: Date.now() - started }));
}

try {
  const up = await waitUp();
  if (!up) throw new Error('السيرفر ماقامش — سجل: ' + serverLog.slice(0, 1500));

  const ver = await req('/api/version');
  ok('السيرفر شغال', ver.status === 200 && !!ver.data.build, ver.data && ver.data.build);

  /* -------- تجهيز مندوب وشكوى -------- */
  const admin = await req('/api/admin/login', j('POST', { password: ADMIN_PASS }));
  ok('دخول الأدمن', admin.status === 200 && !!admin.data.token);
  const AH = { 'x-admin-token': admin.data.token };

  const CODE = 'LIVE001';
  ok('إضافة مندوب', (await req('/api/admin/couriers', j('POST', { das_code: CODE, name: 'مندوب اختبار' }, AH))).status === 200);

  const ticket = await req('/api/tickets', j('POST', {
    das_code: CODE, category: 'الشيفت', sub_type: 'غياب اتسجل غلط', description: 'اختبار لايف'
  }));
  ok('إنشاء شكوى من المندوب', ticket.status === 200 && !!ticket.data.ticket_id);
  const tid = ticket.data.ticket_id;

  /* -------- 1) long-poll بيصحى فورًا على تحديث الشكوى -------- */
  const ev0 = await req('/api/events?wait=0');
  const since0 = ev0.data.rev;
  ok('قراءة rev الأولي', typeof since0 === 'number');

  const lp = longPoll(since0, 12);
  await sleep(250); // نخلي الطلب يمسك في الاستنطار
  const upd = await req(`/api/admin/tickets/${tid}`, j('PUT', { status: 'اتحلت', admin_note: 'اتحلت المشكلة' }, AH));
  ok('تحديث الشكوى من الأدمن', upd.status === 200);

  const got = await lp;
  const kinds = (got.data.events || []).map((e) => e.kind);
  ok('long-poll رجع فورًا (بدون انتظار المهلة)', got.ms < 5000, got.ms + 'ms');
  ok('الحدث وصل: تحديث شكاوى', kinds.includes('tickets'));
  // التنبيه بيتسجل بعد حدث الشكوى بلحظة (حفظه في القاعدة غير متزامن) — بناخده من الجولة اللي بعدها
  const next = await longPoll(got.data.rev, 3);
  const noteEv = [...(got.data.events || []), ...(next.data.events || [])]
    .find((e) => e.kind === 'notify' && e.das_code === CODE);
  ok('حدث التنبيه للمندوب وصل لحظيًا', !!noteEv, noteEv && noteEv.title);

  /* -------- 2) جرس التنبيهات: سطر واحد + عدّاد غير مقروء -------- */
  let box = (await req(`/api/courier/notifications/${CODE}`)).data;
  ok('التنبيه اتسجل في الجرس', (box.notifications || []).length === 1, JSON.stringify(box.notifications && box.notifications[0] && box.notifications[0].title));
  ok('عداد غير المقروء = 1', box.unread === 1);

  /* -------- 3) دمج غير المقروء لنفس الشكوى (بدون تكرار) -------- */
  await req(`/api/admin/tickets/${tid}`, j('PUT', { status: 'لازم تيجي المكتب', admin_note: 'محتاجين نكلمك' }, AH));
  box = (await req(`/api/courier/notifications/${CODE}`)).data;
  ok('التحديث التاني اندمج ومكررش السطر', (box.notifications || []).length === 1, 'count=' + (box.notifications || []).length);
  ok('السطر اتحدّث لآخر حالة', String(box.notifications[0].title).includes('المكتب'), box.notifications[0].title);

  /* -------- 4) تعليم كمقروء + تنبيه جديد يتسجل من جديد -------- */
  ok('تعليم الكل كمقروء', (await req('/api/courier/notifications/read', j('POST', { das_code: CODE }))).status === 200);
  box = (await req(`/api/courier/notifications/${CODE}`)).data;
  ok('العداد رجع صفر', box.unread === 0);

  await req(`/api/admin/tickets/${tid}`, j('PUT', { status: 'اتحلت', admin_note: 'خلصنا خالص' }, AH));
  box = (await req(`/api/courier/notifications/${CODE}`)).data;
  ok('تنبيه جديد بعد القراءة اتسجل كسطر جديد', (box.notifications || []).length === 2, 'count=' + (box.notifications || []).length);
  ok('والمقروء القديم لسه موجود', (box.notifications || []).filter((n) => n.read_at).length === 1);

  /* -------- 5) السلف: قرار صرف = تنبيه لحظي -------- */
  const adv = await req('/api/admin/advances', j('POST', { das_code: CODE, amount: 500, reason: 'سلفة اختبار', wallet: '0100' }, AH));
  ok('تسجيل سلفة من الأدمن', adv.status === 200);
  const paid = await req(`/api/admin/advances/${adv.data.advance_id}`, j('PUT', { status: 'تمت الصرف', admin_note: 'اتحولت' }, AH));
  ok('قرار صرف السلفة', paid.status === 200);
  box = (await req(`/api/courier/notifications/${CODE}`)).data;
  const advNotes = (box.notifications || []).filter((n) => n.kind === 'advance');
  ok('تنبيه السلفة اتسجل مرة واحدة (اتسجلت + اتصرفت دمجوا)', advNotes.length === 1, 'count=' + advNotes.length);

  /* -------- 6) رفع القبض = تنبيه للمندوب المطابق بالكود -------- */
  const upload = await req('/api/admin/payroll/upload', j('POST', {
    title: 'أسبوع اختبار', period: '2026-W44',
    rows: [{ 'Rider ID': CODE, 'Rider Name': 'مندوب اختبار', Zone: 'QCD 1', 'الباقى': '3000', 'الباقي بعد خصم الرسوم': '2800' }]
  }, AH));
  ok('رفع ملف القبض', upload.status === 200 && upload.data.ok, JSON.stringify(upload.data));
  box = (await req(`/api/courier/notifications/${CODE}`)).data;
  const payNotes = (box.notifications || []).filter((n) => n.kind === 'payroll');
  ok('تنبيه قبض وصل للمندوب', payNotes.length === 1, payNotes[0] && payNotes[0].body);

  /* -------- 7) الكروت: حدث لايف -------- */
  const sinceCards = (await req('/api/events?wait=0')).data.rev;
  const cardLp = longPoll(sinceCards, 12);
  await sleep(250);
  const card = await req('/api/admin/cards', j('POST', { title: 'إعلان اختبار', body: 'نص', audience: 'all' }, AH));
  ok('إنشاء كارت', card.status === 200);
  const cardEv = await cardLp;
  ok('حدث الكروت وصل لحظيًا', (cardEv.data.events || []).some((e) => e.kind === 'cards'), cardEv.ms + 'ms');

  /* -------- 8) reset لو rev أعلى من السيرفر -------- */
  const reset = await req('/api/events?since=999999&wait=0');
  ok('reset للعميل الجاي من سيرفر تاني', reset.data.reset === true);

  /* -------- 9) wait=0 بيرجع فورًا بدون جديد -------- */
  const now = (await req('/api/events?wait=0')).data.rev;
  const t0 = Date.now();
  const idle = await req(`/api/events?since=${now}&wait=0`);
  ok('wait=0 بيرجع فورًا', idle.status === 200 && Date.now() - t0 < 1000 && (idle.data.events || []).length === 0);

  console.log(`\n[E2E] ${passed} نجح · ${failed} فشل`);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error('[E2E] خطأ غير متوقع:', e.message);
  console.error(serverLog.slice(-1500));
  process.exitCode = 1;
} finally {
  child.kill();
  await sleep(300);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
}
