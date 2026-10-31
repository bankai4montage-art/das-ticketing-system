#!/usr/bin/env node
/**
 * اختبار تكامل من طرف لدور (E2E): DAS × Bankai Roster — حضور وانصراف
 *
 * بيشغّل على سيرفرين شغّالين (راجع الدليل تحت)، وبيمشي تدفق كامل:
 * طلب مندوب → منع الدبل-كليك → موافقة المشرف الصح / رفض مشرف فرع غلط → مزامنة
 * الحالة في DAS → انصراف بنفس القواعد + كود مش مربوط.
 *
 * التشغيل:
 *   # الطرف الأول: الروستر (نقطتين اختبار على قاعدة مؤقتة)
 *   $env:DATABASE_URL='sqlite:///C:\temp\roster_test.db'
 *   $env:ADMIN_PASSWORD='admin-test-pass'
 *   $env:SUPERVISOR_BRANCH_PASSWORDS='QCD 1=sup-qcd1;QCD 2=sup-qcd2'
 *   $env:DAS_SECRET='e2e-shared-secret'
 *   python -m uvicorn app:app --port 8901
 *
 *   # الطرف التاني: DAS بروب متصل بالروستر وقاعدة مؤقتة
 *   $env:RAILWAY_VOLUME_MOUNT_PATH='C:\temp\das_test'   (بنقبض قاعدة مؤقتة لو غير السعودية)
 *   $env:ADMIN_PASS='das-admin-test'
 *   $env:ROSTER_URL='http://localhost:8901'
 *   $env:ROSTER_ADMIN_PASSWORD='admin-test-pass'
 *   $env:ROSTER_DAS_SECRET='e2e-shared-secret'
 *   $env:PORT='8902'
 *   node server.js
 *
 *   ثم: node test/attendance_e2e.mjs
 */
const ROSTER = (process.env.ROSTER_BASE || 'http://localhost:8901').replace(/\/+$/, '');
const DAS = (process.env.DAS_BASE || 'http://localhost:8902').replace(/\/+$/, '');
const SECRET = process.env.DAS_SECRET || 'e2e-shared-secret';

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

const ROOT = DAS + '/api';

async function main() {
  console.log(`\n[E2E] DAS: ${DAS} · Roster: ${ROSTER}\n`);

  /* 0) خدمات جاهزة */
  ok('Roster health', (await req(ROSTER, '/api/health')).data?.status === 'ok');
  const a = await req(DAS, '/api/version');
  ok('DAS up', a.status === 200);

  /* 1) الأدمن في الطرفين */
  const rosterAdmin = (await req(ROSTER, '/api/login', { body: { password: 'admin-test-pass' } })).data.token;
  ok('Roster admin login', !!rosterAdmin);
  const dasAdmin = (await req(DAS, '/api/admin/login', { body: { password: 'das-admin-test' } })).data.token;
  ok('DAS admin login', !!dasAdmin);
  const dasHdr = { 'x-admin-token': dasAdmin };
  const rHdr = { 'Authorization': 'Bearer ' + rosterAdmin };

  const s1 = (await req(ROSTER, '/api/login', { body: { password: 'sup-qcd1' } })).data;
  const s2 = (await req(ROSTER, '/api/login', { body: { password: 'sup-qcd2' } })).data;
  ok('Branch supervisors', s1?.role === 'supervisor:QCD 1' && s2?.role === 'supervisor:QCD 2');

  /* 2) إنشاء الموظفين في الروستر — المرحلة اللي بتفسّر كود DAS على موظف (admin-managed) */
  const mk = (name, code, branch) => req(ROSTER, '/api/employees', { headers: rHdr, body: {
    name, employee_code: code, branch, shift: branch === 'QCD 1' ? '8 AM - 4 PM' : '10 PM - 6 AM',
    employment_type: 'FT', day_off: 'Friday' } });
  ok('Roster: employee A1 (QCD 1)', (await mk('مندوب A1', 'A1QCD1', 'QCD 1')).status === 200);
  ok('Roster: employee B2 (QCD 2)', (await mk('مندوب B2', 'B2QCD2', 'QCD 2')).status === 200);

  /* 3) كورسيرز DAS — من شيت CSV (المرجع = كود DAS) */
  const csv = 'Code,Name\nA1QCD1,مندوب A1\nB2QCD2,مندوب B2\nC9NOPE,مربوط غلط';
  const m = await fetch(ROOT + '/admin/upload-couriers', { method: 'POST',
    headers: { 'Content-Type': 'text/plain', ...dasHdr }, body: csv });
  ok('DAS: couriers uploaded', m.status === 200 && (await m.json()).count === 3);

  /* 4) حالة المندوب A1 قبل أي طلب */
  let st = (await req(DAS, '/api/courier/attendance/A1QCD1')).data;
  ok('A1 state enabled', st.enabled === true);
  ok('A1 next = check_in', st.state?.next === 'check_in');

  /* 5) انصراف قبل موافقة حضور → مرفوض */
  let r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'A1QCD1', action: 'check_out' } });
  ok('check-out refused without approved check-in', r.status === 409, r.data?.error);

  /* 6) حضور → Pending في الطرفين */
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'A1QCD1', action: 'check_in', device_time: '07:40' } });
  ok('check-in created Pending', r.status === 200 && r.data?.request?.status === 'Pending', r.data?.request?.attendance_date);
  const a1InboxId = r.data?.request?.id;

  /* 7) دبل-كليك → 409 */
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'A1QCD1', action: 'check_in' } });
  ok('duplicate check-in blocked', r.status === 409, r.data?.error);

  /* 8) موافقة مشرف فرع غلط → 403 */
  const pending = (await req(ROSTER, '/api/das/requests/inbox', { headers: { Authorization: 'Bearer ' + (s1.token) } })).data;
  const a1req = pending.requests.find(x => x.employee_code === 'A1QCD1' && x.status === 'Pending');
  ok('roster inbox shows A1 pending', !!a1req);
  r = await req(ROSTER, `/api/das/requests/${a1req.id}/decide`, { headers: { Authorization: 'Bearer ' + s2.token }, body: { decision: 'approve' } });
  ok('QCD 2 supervisor cannot decide QCD 1 request', r.status === 403);

  /* 9) موافقة الأدمن → معتمد ثم مزامنة لجنة DAS */
  r = await req(ROSTER, `/api/das/requests/${a1req.id}/decide`, { headers: rHdr, body: { decision: 'approve' } });
  ok('admin approved check-in', r.status === 200 && r.data.status === 'Approved');
  let a1Status = '';
  for (let i = 0; i < 6; i++) {
    await sleep(2500);
    st = (await req(DAS, '/api/courier/attendance/A1QCD1')).data;
    a1Status = st.requests?.find(x => x.id === a1InboxId)?.status || '';
    if (a1Status === 'Approved') break;
  }
  ok('DAS sees Approved after sync', a1Status === 'Approved', `(state.next=${st.state?.next})`);
  ok('A1 next = check_out', st.state?.next === 'check_out');

  /* 10) انصراف → Pending → موافقة → مزامنة */
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'A1QCD1', action: 'check_out', device_time: '15:10' } });
  ok('check-out created', r.status === 200, JSON.stringify(r.data?.request || r.data));
  const coId = r.data?.request?.id;
  const coRoster = (await req(ROSTER, '/api/das/requests', {})).status;
  ok('sync endpoint restricted without secret', coRoster === 403, 'no header → ' + coRoster);
  r = (await req(ROSTER, '/api/das/requests/inbox', { headers: rHdr })).data;
  const coReq = r.requests.find(x => x.employee_code === 'A1QCD1' && x.status === 'Pending' && x.action === 'check_out');
  ok('roster inbox pending check-out', !!coReq);
  r = await req(ROSTER, `/api/das/requests/${coReq.id}/decide`, { headers: rHdr, body: { decision: 'approve' } });
  ok('admin approved check-out', r.status === 200);
  for (let i = 0; i < 6; i++) {
    await sleep(2500);
    st = (await req(DAS, '/api/courier/attendance/A1QCD1')).data;
    if (st.requests?.find(x => x.id === coId)?.status === 'Approved') break;
  }
  ok('DAS sees check-out Approved', st.requests?.find(x => x.id === coId)?.status === 'Approved', `(state.next=${st.state?.next})`);

  /* 11) كود مش مربوط في الروستر → رفض برسالة واضحة */
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'C9NOPE', action: 'check_in' } });
  ok('unmapped code rejected with clear message', r.status === 409 && /مش مربوط/.test(r.data?.error || ''), r.data?.error);

  /* 12) عزل الفروع من طرف لدور: B2 (QCD 2) يتطلب حضور */
  r = await req(DAS, '/api/courier/attendance/request', { body: { das_code: 'B2QCD2', action: 'check_in' } });
  ok('B2 check-in pending', r.status === 200);
  const b2Inbox = (await req(ROSTER, '/api/das/requests/inbox', { headers: { Authorization: 'Bearer ' + s2.token } })).data;
  ok('QCD 2 supervisor inbox has no A1 requests', !b2Inbox.requests.some(x => x.employee_code === 'A1QCD1'));
  const b2req = b2Inbox.requests.find(x => x.employee_code === 'B2QCD2' && x.status === 'Pending');
  r = await req(ROSTER, `/api/das/requests/${b2req.id}/decide`, { headers: { Authorization: 'Bearer ' + s1.token }, body: { decision: 'approve' } });
  ok('QCD 1 supervisor cannot approve B2', r.status === 403);
  r = await req(ROSTER, `/api/das/requests/${b2req.id}/decide`, { headers: { Authorization: 'Bearer ' + s2.token }, body: { decision: 'reject', note: 'مش النهاردة' } });
  ok('QCD 2 supervisor rejected B2', r.status === 200 && r.data.status === 'Rejected');

  /* 13) الحضور رسمي في تقارير الروستر */
  const emps = await req(ROSTER, '/api/employees?active_only=false', { headers: rHdr });
  const a1emp = emps.data.find(x => x.employee_code === 'A1QCD1');
  /* التقرير بنمرر نطاق صريح زي ما بتعمله الواجهة — اليوم بتوقيت القاهرة */
  const cairoDay = new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
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
