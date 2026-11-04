#!/usr/bin/env node
/**
 * E2E: DAS × Bankai Roster — حضور/انصراف من غير نوافذ وقت
 *
 * بيغطي: تسجيل الحضور والانصراف متاح في أي وقت (حتى قبل الشيفت/في غيابه/يوم
 * الإجازة)، التسلسل المنطقي (مفيش انصراف من غير حضور معتمد + مفيش حضور تاني
 * في نفس يوم الشيفت)، التكرار، عزل الفروع، الكود غير المربوط، والتسجيل الرسمي
 * باسم المشرف في الروستر. المشرف/الأدمن هو اللي يوافق أو يرفض كل طلب.
 *
 * التشغيل (سيرفرين محليين — راجع تعليقات النهاية في git history):
 *   ROSTER_BASE / DAS_BASE افتراضيًا 8901 / 8902
 */
const ROSTER = (process.env.ROSTER_BASE || 'http://localhost:8901').replace(/\/+$/, '');
const DAS = (process.env.DAS_BASE || 'http://localhost:8902').replace(/\/+$/, '');

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ✘ ${name}${extra ? ` — ${extra}` : ''}`); }
};

async function req(base, path, opts = {}) {
  const hasBody = opts.body != null;
  const method = opts.method || (hasBody ? 'POST' : 'GET');
  const res = await fetch(base + path, {
    method,
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: hasBody ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* غير JSON */ }
  return { status: res.status, data };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, tries = 18, ms = 5000) {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(ms);
  }
  return null;
}

const ROOT = DAS + '/api';
const pad = n => String(n).padStart(2, '0');
const nowCairo = () => {
  const d = new Date(Date.now() + 3 * 3600e3);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay() };
};
const hm = m => { const x = ((m % 1440) + 1440) % 1440; return pad(Math.floor(x / 60)) + ':' + pad(x % 60); };
/* شيفت بفارق دقايق عن دلوقتي — لو لفّ منتصف الليل الـ parser بيفهمه شيفت ليلي */
const shiftSpan = (fromMin, toMin) => `${hm(nowCairo().minutes + fromMin)}-${hm(nowCairo().minutes + toMin)}`;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function main() {
  console.log(`\n[E2E] DAS: ${DAS} · Roster: ${ROSTER}\n`);

  /* 0) خدمات جاهزة */
  ok('Roster health', (await req(ROSTER, '/api/health')).data?.status === 'ok');
  ok('DAS up', (await req(DAS, '/api/version')).status === 200);

  /* 1) تسجيل الدخول */
  const rosterAdmin = (await req(ROSTER, '/api/login', { body: { password: 'admin-test-pass' } })).data.token;
  ok('Roster admin login', !!rosterAdmin);
  const dasAdmin = (await req(DAS, '/api/admin/login', { body: { password: 'das-admin-test' } })).data.token;
  ok('DAS admin login', !!dasAdmin);
  const dasHdr = { 'x-admin-token': dasAdmin };
  const rHdr = { Authorization: 'Bearer ' + rosterAdmin };

  const s1 = (await req(ROSTER, '/api/login', { body: { password: 'sup-qcd1' } })).data;
  const s2 = (await req(ROSTER, '/api/login', { body: { password: 'sup-qcd2' } })).data;
  ok('Branch supervisors', s1?.role === 'supervisor:QCD 1' && s2?.role === 'supervisor:QCD 2');

  /* 2) موظفين بشيفتات محسوبة حول وقت الاختبار — مفيش باب وقت تاني، الشيفات هنا بس
     عشان نتأكد إن التسجيل شغال حتى بره نطاق الشيفت */
  const mk = (name, code, branch, shift, dayOff = 'Friday') => req(ROSTER, '/api/employees', { headers: rHdr, body: {
    name, employee_code: code, branch, shift, employment_type: 'FT', day_off: dayOff } });

  const A1_SHIFT = shiftSpan(-30, 120);    // جوه الشيفت الآن
  const B2_SHIFT = shiftSpan(-60, 120);
  const C3_SHIFT = shiftSpan(180, 600);    // لسه ما فتحش — التسجيل لازم يبقى متاح برضه
  const D4_SHIFT = shiftSpan(-30, 120);    // نهايته بعيدة — الانصراف ينفع فورًا بعد موافقة الحضور
  const E5_SHIFT = shiftSpan(-30, 120);
  const TODAY_DOW = DAYS[nowCairo().dow];

  ok('Roster: employee A1 (QCD 1)', (await mk('مندوب A1', 'A1QCD1', 'QCD 1', A1_SHIFT)).status === 200);
  ok('Roster: employee B2 (QCD 2)', (await mk('مندوب B2', 'B2QCD2', 'QCD 2', B2_SHIFT)).status === 200);
  ok('Roster: employee C3 (pre-shift check-in)', (await mk('مندوب C3', 'C3QCD1', 'QCD 1', C3_SHIFT)).status === 200);
  ok('Roster: employee D4 (instant check-out)', (await mk('مندوب D4', 'D4QCD1', 'QCD 1', D4_SHIFT)).status === 200);
  ok('Roster: employee E5 (day off)', (await mk('مندوب E5', 'E5QCD1', 'QCD 1', E5_SHIFT, TODAY_DOW)).status === 200);

  /* 3) كورسيرز DAS (كود = مرجع الربط) */
  const csv = 'Code,Name\nA1QCD1,مندوب A1\nB2QCD2,مندوب B2\nC3QCD1,مندوب C3\nD4QCD1,مندوب D4\nE5QCD1,مندوب E5\nC9NOPE,مربوط غلط';
  const m = await fetch(ROOT + '/admin/upload-couriers', { method: 'POST',
    headers: { 'Content-Type': 'text/plain', ...dasHdr }, body: csv });
  ok('DAS: couriers uploaded', m.status === 200 && (await m.json()).count === 6);

  /* 4) حالة A1: شيفته ظاهر والحضور متاح */
  let st = (await req(DAS, '/api/courier/attendance/A1QCD1')).data;
  ok('A1 state enabled + shift shown', st.enabled === true && !!st.shift?.text && /[صم]/.test(st.shift.text), st.shift?.text);
  ok('A1 next = check_in (available now)', st.state?.next === 'check_in');

  /* 5) انصراف قبل الحضور → مرفوض */
  let r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'A1QCD1', action: 'check_out' } });
  ok('check-out refused without approved check-in', r.status === 409, r.data?.error);

  /* 6) C3: شيفت لسه ما فتحش — الحضور متاح في أي وقت (مفيش باب وقت) */
  st = (await req(DAS, '/api/courier/attendance/C3QCD1')).data;
  ok('C3 state open before shift (no time gate)', st.state?.next === 'check_in', st.state?.why);
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'C3QCD1', action: 'check_in' } });
  ok('pre-shift check-in accepted as Pending', r.status === 200 && r.data?.request?.status === 'Pending', JSON.stringify(r.data?.request || r.data));
  const c3req = (await req(ROSTER, '/api/das/requests/inbox', { headers: rHdr })).data.requests
    .find(x => x.employee_code === 'C3QCD1' && x.status === 'Pending' && x.action === 'check_in');
  ok('roster inbox shows C3 pending', !!c3req);
  r = await req(ROSTER, `/api/das/requests/${c3req.id}/decide`, { headers: rHdr, body: { decision: 'approve' } });
  ok('admin approved C3 pre-shift check-in', r.status === 200 && r.data.status === 'Approved');

  /* 7) E5: يوم الإجازة — التسجيل متاح والمشرف هو اللي يقرر (موافقة/رفض) */
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'E5QCD1', action: 'check_in' } });
  ok('day-off check-in accepted as Pending', r.status === 200 && r.data?.request?.status === 'Pending', r.data?.error);
  const e5req = (await req(ROSTER, '/api/das/requests/inbox', { headers: rHdr })).data.requests
    .find(x => x.employee_code === 'E5QCD1' && x.status === 'Pending' && x.action === 'check_in');
  r = await req(ROSTER, `/api/das/requests/${e5req.id}/decide`, { headers: rHdr, body: { decision: 'approve' } });
  ok('admin approved E5 day-off check-in', r.status === 200 && r.data.status === 'Approved');

  /* 8) D4: حضور → موافقة → انصراف فورًا حتى لو الشيفت ما خلصش */
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'D4QCD1', action: 'check_in', device_time: '00:00' } });
  ok('D4 check-in pending', r.status === 200 && r.data?.request?.status === 'Pending', JSON.stringify(r.data?.request || r.data));
  const d4InId = r.data?.request?.id;
  const d4PendingNow = (await req(ROSTER, '/api/das/requests/inbox', { headers: rHdr })).data.requests
    .find(x => x.employee_code === 'D4QCD1' && x.status === 'Pending' && x.action === 'check_in');
  r = await req(ROSTER, `/api/das/requests/${d4PendingNow.id}/decide`, { headers: rHdr, body: { decision: 'approve' } });
  ok('admin approved D4 check-in', r.status === 200 && r.data.status === 'Approved');
  const d4InSynced = await waitFor(async () => {
    const s = (await req(DAS, '/api/courier/attendance/D4QCD1')).data;
    return s.requests?.find(x => x.id === d4InId)?.status === 'Approved' ? s : null;
  });
  ok('DAS sees D4 check-in Approved', !!d4InSynced);
  ok('D4 check-out available right after approval', d4InSynced?.state?.next === 'check_out', d4InSynced?.state?.why);
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'D4QCD1', action: 'check_out', device_time: '17:00' } });
  ok('D4 check-out accepted before shift end', r.status === 200 && r.data?.request?.status === 'Pending', JSON.stringify(r.data?.request || r.data));
  const d4OutId = r.data?.request?.id;
  const d4Out = (await req(ROSTER, '/api/das/requests/inbox', { headers: rHdr })).data.requests
    .find(x => x.employee_code === 'D4QCD1' && x.status === 'Pending' && x.action === 'check_out');
  ok('roster inbox pending D4 check-out', !!d4Out);
  r = await req(ROSTER, `/api/das/requests/${d4Out.id}/decide`, { headers: rHdr, body: { decision: 'approve' } });
  ok('admin approved D4 check-out', r.status === 200);

  /* 9) A1: حضور → Pending → دبل كليك → صلاحيات الفروع */
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'A1QCD1', action: 'check_in', device_time: '07:40' } });
  ok('A1 check-in created Pending', r.status === 200 && r.data?.request?.status === 'Pending', r.data?.request?.attendance_date);
  const a1InboxId = r.data?.request?.id;

  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'A1QCD1', action: 'check_in' } });
  ok('duplicate check-in blocked', r.status === 409, r.data?.error);

  const pending = (await req(ROSTER, '/api/das/requests/inbox', { headers: { Authorization: 'Bearer ' + s1.token } })).data;
  const a1req = pending.requests.find(x => x.employee_code === 'A1QCD1' && x.status === 'Pending');
  ok('roster inbox shows A1 pending', !!a1req);
  r = await req(ROSTER, `/api/das/requests/${a1req.id}/decide`, { headers: { Authorization: 'Bearer ' + s2.token }, body: { decision: 'approve' } });
  ok('QCD 2 supervisor cannot decide QCD 1 request', r.status === 403);

  r = await req(ROSTER, `/api/das/requests/${a1req.id}/decide`, { headers: rHdr, body: { decision: 'approve' } });
  ok('admin approved check-in', r.status === 200 && r.data.status === 'Approved');

  /* 10) بعد موافقة الحضور: الانصراف متاح فورًا — مفيش نافذة وقت */
  st = await waitFor(async () => {
    const s = (await req(DAS, '/api/courier/attendance/A1QCD1')).data;
    return s.requests?.find(x => x.id === a1InboxId)?.status === 'Approved' ? s : null;
  });
  ok('DAS sees Approved after sync', !!st);
  ok('A1 check-out open right after approval', st?.state?.next === 'check_out', st?.state?.why);
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'A1QCD1', action: 'check_out' } });
  ok('A1 check-out created immediately', r.status === 200 && r.data?.request?.status === 'Pending', r.data?.error);
  const a1OutId = r.data?.request?.id;
  const a1Out = (await req(ROSTER, '/api/das/requests/inbox', { headers: rHdr })).data.requests
    .find(x => x.employee_code === 'A1QCD1' && x.status === 'Pending' && x.action === 'check_out');
  ok('roster inbox pending A1 check-out', !!a1Out);
  r = await req(ROSTER, `/api/das/requests/${a1Out.id}/decide`, { headers: rHdr, body: { decision: 'approve' } });
  ok('admin approved A1 check-out', r.status === 200 && r.data.status === 'Approved');

  /* 11) الدورة كاملة النهاردة → حضور تاني ممنوع (قاعدة يوم مش قاعدة وقت) */
  const a1Done = await waitFor(async () => {
    const s = (await req(DAS, '/api/courier/attendance/A1QCD1')).data;
    return s.requests?.find(x => x.id === a1OutId)?.status === 'Approved' ? s : null;
  });
  ok('DAS sees A1 check-out Approved', !!a1Done);
  st = (await req(DAS, '/api/courier/attendance/A1QCD1')).data;
  ok('full cycle blocks same-day re check-in', st.state?.blocked === true && /النهاردة/.test(st.state?.why || ''), st.state?.why);
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'A1QCD1', action: 'check_in' } });
  ok('same-day re check-in rejected', r.status === 409, r.data?.error);
  const d4Synced = await waitFor(async () => {
    const s = (await req(DAS, '/api/courier/attendance/D4QCD1')).data;
    return s.requests?.find(x => x.id === d4OutId)?.status === 'Approved' ? s : null;
  });
  ok('DAS sees D4 check-out Approved', !!d4Synced);

  /* 12) كود مش مربوط */
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'C9NOPE', action: 'check_in' } });
  ok('unmapped code rejected with clear message', r.status === 409 && /مش مربوط/.test(r.data?.error || ''), r.data?.error);

  /* 13) B2: عزل الفروع */
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'B2QCD2', action: 'check_in' } });
  ok('B2 check-in pending', r.status === 200);
  const b2Inbox = (await req(ROSTER, '/api/das/requests/inbox', { headers: { Authorization: 'Bearer ' + s2.token } })).data;
  ok('QCD 2 supervisor inbox has no A1 requests', !b2Inbox.requests.some(x => x.employee_code === 'A1QCD1'));
  const b2req = b2Inbox.requests.find(x => x.employee_code === 'B2QCD2' && x.status === 'Pending');
  r = await req(ROSTER, `/api/das/requests/${b2req.id}/decide`, { headers: { Authorization: 'Bearer ' + s1.token }, body: { decision: 'approve' } });
  ok('QCD 1 supervisor cannot approve B2', r.status === 403);
  r = await req(ROSTER, `/api/das/requests/${b2req.id}/decide`, { headers: { Authorization: 'Bearer ' + s2.token }, body: { decision: 'reject', note: 'مش النهاردة' } });
  ok('QCD 2 supervisor rejected B2', r.status === 200 && r.data.status === 'Rejected');

  /* 14) التسجيل الرسمي في الروستر (A1 حضور معتمد) */
  ok('sync endpoint restricted without secret', (await req(ROSTER, '/api/das/requests', {})).status === 403);
  const emps = await req(ROSTER, '/api/employees?active_only=false', { headers: rHdr });
  const a1emp = emps.data.find(x => x.employee_code === 'A1QCD1');
  const cairoDay = nowCairo().date;
  const rep = await req(ROSTER, `/api/reports/employee/${a1emp.id}?start=${cairoDay}&end=${cairoDay}`, { headers: rHdr });
  const presentRow = rep.data.records?.find(x => x.status === 'Present');
  ok('official attendance row written in Roster', !!presentRow && /حضور DAS/.test(presentRow.note || ''), presentRow?.note);
  ok('roster stats counted Present', (rep.data.stats?.present || 0) >= 1);

  console.log(`\n[E2E] النتيجة: ${passed} نجح / ${failed} فشل\n`);
  process.exitCode = failed ? 1 : 0;
}

import fs from 'node:fs';

function fatal(e) {
  try { fs.writeFileSync('e2e_stack.txt', String(e.stack || e)); } catch (e2) { /* */ }
  console.error('[E2E] fatal:', e.message);
  process.exitCode = 1;
}
main().catch(fatal);
