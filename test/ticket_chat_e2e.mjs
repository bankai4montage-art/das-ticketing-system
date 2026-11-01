#!/usr/bin/env node
/**
 * E2E: محادثة الشكوى + الإقفال النهائي
 *
 * بيشغّل نسخة سيرفر مستقلة على قاعدة مؤقتة، وبيتأكد من:
 *   - رد الإدارة بيظهر للمندوب + بيتسجل تنبيه في جرسه (مرة واحدة لكل شكوى)
 *   - رد المندوب بيظهر للإدارة وبيتحسب "غير مقروء" لسه + بيتعلّم مقروء لما الأدمن يفتح
 *   - المندوب ما يقدرش يرد على شكوى مش بتاعته
 *   - الإقفال النهائي بيوقف الردود على الطرفين، وإعادة الفتح بترجّعها
 *   - مسح الشكوى بيمسح محادثتها
 *
 * التشغيل: node test/ticket_chat_e2e.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = process.env.TEST_PORT || '8907';
const BASE = `http://localhost:${PORT}`;
const ADMIN_PASS = 'chat-test-pass-123';

let passed = 0, failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  ✔ ${name}${extra ? ` — ${extra}` : ''}`); }
  else { failed++; console.log(`  ✘ ${name}${extra ? ` — ${extra}` : ''}`); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (method, body, headers = {}) => ({
  method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body)
});

async function req(pathname, opts = {}) {
  const res = await fetch(BASE + pathname, opts);
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'das-chat-'));
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve(import.meta.dirname, '..'),
  env: { ...process.env, PORT, RAILWAY_VOLUME_MOUNT_PATH: tmpDir, ADMIN_PASS, NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

try {
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(BASE + '/api/version')).ok) { up = true; break; } } catch (e) {}
    await sleep(250);
  }
  if (!up) throw new Error('السيرفر ماقامش: ' + log.slice(0, 800));

  const admin = await req('/api/admin/login', j('POST', { password: ADMIN_PASS }));
  const AH = { 'x-admin-token': admin.data.token };

  await req('/api/admin/couriers', j('POST', { das_code: 'CHAT1', name: 'مندوب شات' }, AH));
  await req('/api/admin/couriers', j('POST', { das_code: 'CHAT2', name: 'مندوب تاني' }, AH));
  const t = await req('/api/tickets', j('POST', {
    das_code: 'CHAT1', category: 'الشيفت', sub_type: 'مشكلة حضور وانصراف', description: 'محتاج توضيح'
  }));
  const tid = t.data.ticket_id;
  ok('إنشاء شكوى', !!tid, '#' + tid);

  /* ---------- 1) رد الإدارة ---------- */
  const adminMsg = await req(`/api/admin/tickets/${tid}/messages`, j('POST', { body: 'ابعتلي صورة الحضور' }, AH));
  ok('رد الإدارة اتسجل', adminMsg.status === 200 && adminMsg.data.id > 0);

  let cm = await req(`/api/courier/tickets/${tid}/messages?das_code=CHAT1`);
  ok('رد الإدارة ظاهر للمندوب', cm.status === 200 && cm.data.messages.length === 1 && cm.data.messages[0].body.includes('صورة الحضور'));
  ok('الشكوى مش مقفولة', cm.data.closed === false);

  const notes = await req('/api/courier/notifications/CHAT1');
  const chatNote = (notes.data.notifications || []).find((n) => n.kind === 'ticket');
  ok('تنبيه «رد جديد» وصل جرس المندوب', !!chatNote, chatNote && chatNote.title);

  // فتح المحادثة علّمها مقروءة
  const tk = await req('/api/courier/tickets/CHAT1');
  ok('عداد المحادثة غير المقروء بيرجع صفر بعد الفتح', tk.data.tickets[0].chat_unread === 0);

  /* ---------- 2) رد المندوب ---------- */
  const courierMsg = await req(`/api/courier/tickets/${tid}/messages`, j('POST', { das_code: 'CHAT1', body: 'دي صورة الحضور يا فندم' }));
  ok('رد المندوب اتسجل', courierMsg.status === 200);

  const listBefore = await req('/api/admin/tickets', { headers: AH });
  const rowBefore = listBefore.data.tickets.find((x) => x.id === tid);
  ok('عداد رسايل المندوب غير المقروءة للإدارة = 1', rowBefore.chat_unread === 1, 'chat_unread=' + rowBefore.chat_unread);

  let al = await req(`/api/admin/tickets/${tid}/messages`, { headers: AH });
  ok('رد المندوب ظاهر للإدارة', al.data.messages.some((m) => m.sender === 'courier' && m.body.includes('صورة الحضور يا فندم')));

  const listAfter = await req('/api/admin/tickets', { headers: AH });
  const rowAfter = listAfter.data.tickets.find((x) => x.id === tid);
  ok('العداد رجع صفر بعد ما الإدارة فتحت', rowAfter.chat_unread === 0);

  /* ---------- 3) مندوب تاني ما يقدرش ---------- */
  const other = await req(`/api/courier/tickets/${tid}/messages`, j('POST', { das_code: 'CHAT2', body: 'محاولة' }));
  ok('مندوب تاني ممنوع من الكتابة (403)', other.status === 403);

  /* ---------- 4) الإقفال النهائي ---------- */
  const close = await req(`/api/admin/tickets/${tid}/close`, j('PUT', { closed: true }, AH));
  ok('الإقفال النهائي', close.status === 200 && close.data.closed === true);

  cm = await req(`/api/courier/tickets/${tid}/messages?das_code=CHAT1`);
  ok('المندوب شايف الشكوى مقفولة', cm.data.closed === true && !!cm.data.closed_at);

  const blocked = await req(`/api/courier/tickets/${tid}/messages`, j('POST', { das_code: 'CHAT1', body: 'بعد الإقفال' }));
  ok('المندوب ممنوع يرد بعد الإقفال (409)', blocked.status === 409, blocked.data.error);

  const blockedAdmin = await req(`/api/admin/tickets/${tid}/messages`, j('POST', { body: 'رد الإدارة بعد الإقفال' }, AH));
  ok('الإدارة كمان ممنوعة ترد قبل إعادة الفتح', blockedAdmin.status === 409);

  const tkClosed = await req('/api/courier/tickets/CHAT1');
  ok('قايمة المندوب بترجّع closed_at', !!tkClosed.data.tickets[0].closed_at);

  const closeNote = (await req('/api/courier/notifications/CHAT1')).data.notifications.find((n) => n.title.includes('اتقفلت'));
  ok('تنبيه «اتقفلت نهائيًا» وصل للمندوب', !!closeNote);

  const reopen = await req(`/api/admin/tickets/${tid}/close`, j('PUT', { closed: false }, AH));
  ok('إعادة الفتح', reopen.status === 200 && reopen.data.closed === false);
  const afterReopen = await req(`/api/courier/tickets/${tid}/messages`, j('POST', { das_code: 'CHAT1', body: 'رجعت أكتب تاني' }));
  ok('المندوب يقدر يرد تاني بعد الفتح', afterReopen.status === 200);

  /* ---------- 5) مسح الشكوى بيمسح المحادثة ---------- */
  const del = await req(`/api/admin/tickets/${tid}`, { method: 'DELETE', headers: AH });
  ok('مسح الشكوى', del.status === 200);
  const gone = await req(`/api/courier/tickets/${tid}/messages?das_code=CHAT1`);
  ok('الشكوى ومحادثتها اتمسحوا', gone.status === 404);

  console.log(`\n[CHAT] ${passed} نجح · ${failed} فشل`);
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  console.error('[CHAT] خطأ غير متوقع:', e.message);
  console.error(log.slice(-1200));
  process.exitCode = 1;
} finally {
  child.kill();
  await sleep(300);
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
}
