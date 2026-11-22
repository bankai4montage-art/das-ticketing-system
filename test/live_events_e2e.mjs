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
  const REF_CODE = 'LIVE002';
  ok('إضافة مندوب', (await req('/api/admin/couriers', j('POST', { das_code: CODE, name: 'مندوب اختبار' }, AH))).status === 200);
  ok('إضافة مندوب تاني لإرجاع الغرامة', (await req('/api/admin/couriers', j('POST', { das_code: REF_CODE, name: 'مندوب إرجاع' }, AH))).status === 200);

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

  /* -------- 5-ب) منع طلب سلفة جديد قبل رد الإدارة -------- */
  const firstReq = await req('/api/advances', j('POST', {
    das_code: CODE, amount: 250, reason: 'طلب سلفة اختبار', wallet: '01000000000', wallet_type: 'instapay'
  }));
  ok('المندوب يقدر يبعت طلب سلفة', firstReq.status === 200);
  const secondReq = await req('/api/advances', j('POST', {
    das_code: CODE, amount: 300, reason: 'طلب تاني', wallet: '01000000000', wallet_type: 'wallet'
  }));
  ok('طلب جديد مرفوض وطلب السلفة السابق لسه قيد المراجعة', secondReq.status === 409 && secondReq.data.pending === true);
  const courierAdvances = (await req(`/api/courier/advances/${CODE}`)).data.advances || [];
  const latestAdv = courierAdvances.find((a) => a.id === firstReq.data.advance_id);
  ok('طريقة التحويل اتسجلت (إنستاباي)', latestAdv && latestAdv.wallet_type === 'instapay');
  await req(`/api/admin/advances/${firstReq.data.advance_id}`, j('PUT', { status: 'مرفوضة', admin_note: 'مرفوض' }, AH));
  const thirdReq = await req('/api/advances', j('POST', {
    das_code: CODE, amount: 350, reason: 'بعد الرد', wallet: '01000000000', wallet_type: 'wallet'
  }));
  ok('بعد رد الإدارة يقدر يبعت طلب جديد', thirdReq.status === 200);

  /* -------- 6) رفع القبض: ملف مخفي لحد ما الأدمن يعرضه = تنبيه للمندوب -------- */
  const upload = await req('/api/admin/payroll/upload', j('POST', {
    title: 'أسبوع اختبار', period: '2026-W44',
    rows: [
      { 'Rider ID': CODE, 'Rider Name': 'مندوب اختبار', Zone: 'QCD 1', 'غرامة': '-150', 'الباقى': '3000', 'الباقي بعد خصم الرسوم': '2800' },
      { 'Rider ID': REF_CODE, 'Rider Name': 'مندوب إرجاع', Zone: 'QCD 1', 'غرامة': '200', 'الباقى': '1200', 'الباقي بعد خصم الرسوم': '1150' }
    ]
  }, AH));
  ok('رفع ملف القبض', upload.status === 200 && upload.data.ok, JSON.stringify(upload.data));
  ok('الملف بيترفع مخفي افتراضيًا', upload.data.published === false);
  const hiddenPay = await req(`/api/courier/payroll/${CODE}`);
  ok('تفاصيل القبض المخفية مش ظاهرة للمندوب', (hiddenPay.data.payroll || []).length === 0);
  box = (await req(`/api/courier/notifications/${CODE}`)).data;
  ok('مفيش تنبيه قبض قبل ما الملف يتعرض', (box.notifications || []).filter((n) => n.kind === 'payroll').length === 0);

  const publish = await req(`/api/admin/payroll/files/${upload.data.file_id}/publish`, j('PUT', { published: true }, AH));
  ok('عرض ملف القبض للمناديب', publish.status === 200 && publish.data.published === true);
  await sleep(300); // التنبيه بيتبعت بعد رد النشر
  box = (await req(`/api/courier/notifications/${CODE}`)).data;
  const payNotes = (box.notifications || []).filter((n) => n.kind === 'payroll');
  ok('تنبيه قبض وصل للمندوب بعد العرض', payNotes.length === 1, payNotes[0] && payNotes[0].body);
  const shownPay = await req(`/api/courier/payroll/${CODE}`);
  ok('تفاصيل القبض ظهرت للمندوب بعد العرض', (shownPay.data.payroll || []).length === 1);

  /* -------- 6-ب) عمود الغرامة: السالب غرامة والموجب إرجاع غرامة -------- */
  const finesList = (await req('/api/admin/payroll/fines', { headers: AH })).data.fines || [];
  const fineMove = finesList.find((f) => f.rider_id === CODE);
  const refundMove = finesList.find((f) => f.rider_id === REF_CODE);
  ok('الغرامة السالبة اتحددت كغرامة', fineMove && Number(fineMove.fine) === -150 && fineMove.fine_type === 'fine');
  ok('القيمة الموجبة اتحددت كإرجاع غرامة', refundMove && Number(refundMove.fine) === 200 && refundMove.fine_type === 'refund');
  const refBefore = (await req(`/api/courier/notifications/${REF_CODE}`)).data;
  ok('مفيش تنبيه غرامة للمندوب قبل تسجيل السبب', (refBefore.notifications || []).filter((n) => n.kind === 'fine').length === 0);
  await req(`/api/admin/payroll/rows/${refundMove.id}/fine-reason`, j('PUT', { reason: 'الغرامة اتخصمت بالغلط ورجعت' }, AH));
  await sleep(500);
  const refBox = (await req(`/api/courier/notifications/${REF_CODE}`)).data;
  const refundNotes = (refBox.notifications || []).filter((n) => n.kind === 'fine');
  ok('تنبيه إرجاع الغرامة وصل بعنوان واضح', refundNotes.length === 1 && refundNotes[0].title.includes('إرجاع غرامة'),
    refundNotes[0] && refundNotes[0].title);

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

  /* -------- 10) مسح مندوب من القايمة (بياناته التاريخية تفضل موجودة) -------- */
  const delMissing = await req('/api/admin/couriers/NOPE999', { method: 'DELETE', headers: AH });
  ok('مسح مندوب مش موجود مرفوض', delMissing.status === 404, 'status=' + delMissing.status);
  const delNoAuth = await req('/api/admin/couriers/' + CODE, { method: 'DELETE' });
  ok('مسح مندوب بدون توكن مرفوض', delNoAuth.status === 401, 'status=' + delNoAuth.status);
  const delC = await req('/api/admin/couriers/' + CODE, { method: 'DELETE', headers: AH });
  const courierList = (await req('/api/admin/couriers', { headers: AH })).data.couriers || [];
  ok('مسح المندوب من القايمة', delC.status === 200 && !courierList.some((c) => c.das_code === CODE), 'status=' + delC.status);
  const keptAdvances = (await req('/api/admin/advances', { headers: AH })).data.advances || [];
  ok('سلف المندوب المحذوف تفضل موجودة في التقارير', keptAdvances.some((a) => a.das_code === CODE));

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
