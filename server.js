const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse');
const webpush = require('web-push');

const app = express();
const PORT = process.env.PORT || 3000;

const isProd = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;

// باسورد الأدمن إجباري في الإنتاج — القيمة الافتراضية للتجربة المحلية بس
const ADMIN_PASS = process.env.ADMIN_PASS || '';
if (isProd && !ADMIN_PASS) {
  console.error('[DAS] ADMIN_PASS is required in production — set it from Variables and restart');
  process.exit(1);
}
if (!ADMIN_PASS) {
  console.warn('[DAS] WARNING: ADMIN_PASS is not set — falling back to admin123 (local dev only)');
}
const adminPass = ADMIN_PASS || 'admin123';

// مفاتيح Web Push (VAPID) — من Variables على Railway أو بيئة محلية
// لو ناقصة، الإشعارات بتقفل بنفسها وواجهة المندوب بتخفي الزرار
const PUSH_PUBLIC_KEY = process.env.PUSH_PUBLIC_KEY || '';
const PUSH_PRIVATE_KEY = process.env.PUSH_PRIVATE_KEY || '';
const PUSH_SUBJECT = process.env.PUSH_SUBJECT || 'mailto:admin@das-portal.app';
const pushEnabled = Boolean(PUSH_PUBLIC_KEY && PUSH_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails(PUSH_SUBJECT, PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY);
}

// توكن الأدمن — ثابت عبر إعادة التشغيل وإعادة النشر (مش عشوائي)
// قبل كده كان crypto.randomBytes كل مرة السيرفر يقلع، فأي redeploy (أو لو
// السيرفر بيشغّل أكتر من نسخة ورا load balancer) كان بيبطّل جلسة الأدمن:
// كل طلب بيرجع 401 والصفحة بتعمل reload → 401 تاني → حلقة إعادة تحميل
// لا نهائية ("retry loop"). دلوقتي بيتحسب من الباسورد نفسه فيفضل ثابت
// ما دام الباسورد ما اتغيّرش.
const ADMIN_TOKEN = crypto.createHmac('sha256', adminPass).update('das-admin-session-v1').digest('hex');

// مقارنة ثابتة الزمن — بتقفل هجوم التوقيت على الباسورد والتوكن
function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest();
  const hb = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// مسار الداتا بيز (يدعم Railway Volume لو ضفته، أو يشتغل محلياً)
const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'database.db')
  : path.join(__dirname, 'database.db');

const db = new sqlite3.Database(dbPath);
// WAL بتقلل مشاكل الكتابة المتزامنة والقفل لو حصل restart وقت الكتابة
db.run('PRAGMA journal_mode = WAL');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ------------------------- نسخة البيلد ------------------------- */
// رقم بيتغيّر مع كل نشر. الواجهات بتقارنه كل شوية وبتعمل reload لوحدها،
// فالتحديث بيوصل للمستخدم من غير ما يعمل refresh للصفحة بنفسه.
const BUILD_ID = (() => {
  const fs = require('fs');
  const parts = [];
  const stamp = (p) => {
    try { parts.push(path.basename(p) + ':' + Math.round(fs.statSync(p).mtimeMs)); } catch (e) { /* ملف مش موجود */ }
  };
  stamp(__filename);
  ['public/admin.html', 'public/index.html', 'public/assets/common.js',
   'public/assets/style.css', 'public/assets/i18n.js'].forEach((f) => stamp(path.join(__dirname, f)));
  const hash = crypto.createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10);
  const sha = String(process.env.RAILWAY_GIT_COMMIT_SHA || '').slice(0, 7);
  return sha ? `${sha}-${hash}` : hash;
})();

app.get('/api/version', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ build: BUILD_ID });
});

// Rate limiting بسيط بدون مكتبات — بيقفل التخمين والسبام.
// ورا Railway البروكسي هو اللي شايف الـ IP، فبنقرأ x-forwarded-for الأول
const hits = new Map();
function rateLimited(req, bucket, max, windowMs) {
  const fwd = String(req.headers['x-forwarded-for'] || '');
  const ip = fwd.split(',')[0].trim() || req.socket.remoteAddress || '?';
  const key = ip + ':' + bucket;
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of hits) if (!v.some((t) => now - t < 3600e3)) hits.delete(k);
}, 3600e3).unref();

const STATUSES = ['يتم المراجعة', 'اتحلت', 'لازم تيجي المكتب', 'مرفوض', 'مرفوض بسبب الروستر'];
const ADV_STATUSES = ['قيد المراجعة', 'تمت الصرف', 'مرفوضة'];

// الأرشفة التلقائية: الشكوى اللي اتحلت ومعدّش على حلها 30 يوم بتتأرشف (بتخرج من الجدول الرئيسي)
let lastSweep = 0;
function sweepArchive() {
  const now = Date.now();
  if (now - lastSweep < 60e3) return;
  lastSweep = now;
  db.run(
    "UPDATE tickets SET archived = 1 WHERE archived = 0 AND status = 'اتحلت' AND updated_at <= datetime('now', '-30 days')",
    function (err) { if (!err && this.changes > 0) BUS.publish('tickets', { reason: 'archive' }); }
  );
}

// إنشاء الجداول وإضافة بيانات مبدئية (للتجربة المحلية فقط — مش في الإنتاج)
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS couriers (
      das_code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      das_code TEXT NOT NULL,
      courier_name TEXT NOT NULL,
      category TEXT NOT NULL,
      sub_type TEXT NOT NULL,
      issue_date TEXT,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'يتم المراجعة',
      admin_note TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archived INTEGER DEFAULT 0,
      rating INTEGER,
      rating_note TEXT DEFAULT '',
      rated_at DATETIME,
      seen_note TEXT DEFAULT '',
      seen_at DATETIME
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS advances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      das_code TEXT NOT NULL,
      courier_name TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      wallet TEXT NOT NULL,
      status TEXT DEFAULT 'قيد المراجعة',
      admin_note TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS push_subs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      das_code TEXT NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // كروت مخصصة الأدمن بيعملها وتظهر لصفحة المندوب بشروط ظهور (جمهور + فترة)
  db.run(`
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      button_text TEXT DEFAULT '',
      button_url TEXT DEFAULT '',
      audience TEXT DEFAULT 'all',
      audience_value TEXT DEFAULT '',
      start_date TEXT DEFAULT '',
      end_date TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      choices TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // إعدادات زر تحميل تطبيق المندوب (Bankai Smart) + استهداف الظهور
  db.run(`
    CREATE TABLE IF NOT EXISTS app_release (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER DEFAULT 0,
      title TEXT DEFAULT '',
      body TEXT DEFAULT '',
      apk_url TEXT DEFAULT '',
      version TEXT DEFAULT '',
      audience TEXT DEFAULT 'all',
      audience_value TEXT DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run("INSERT OR IGNORE INTO app_release (id) VALUES (1)");

  // أصوات المناديب على الخيارات التفاعلية — صوت واحد لكل مندوب لكل كارت (وبيقدر يغيره)
  db.run(`
    CREATE TABLE IF NOT EXISTS card_picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id INTEGER NOT NULL,
      das_code TEXT NOT NULL,
      courier_name TEXT DEFAULT '',
      choice INTEGER NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(card_id, das_code)
    )
  `);

  // جداول القبض: ملفات الأسبوع المرفوعة من الأدمن + صفوف المناديب المتفصلة
  db.run(`
    CREATE TABLE IF NOT EXISTS payroll_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      period TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      rows_n INTEGER DEFAULT 0,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      uploaded_by TEXT DEFAULT ''
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS payroll (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL,
      period TEXT DEFAULT '',
      zone TEXT DEFAULT '',
      sp TEXT DEFAULT '',
      rider_id TEXT NOT NULL,
      rider_name TEXT DEFAULT '',
      days REAL DEFAULT 0, orders_n REAL DEFAULT 0, order_price REAL DEFAULT 0, orders_value REAL DEFAULT 0,
      amazon_n REAL DEFAULT 0, guarantee_price REAL DEFAULT 0, guarantee_value REAL DEFAULT 0,
      salary REAL DEFAULT 0, bonus REAL DEFAULT 0, distance_bonus REAL DEFAULT 0, tibas REAL DEFAULT 0,
      total_pilot REAL DEFAULT 0, prev_taken REAL DEFAULT 0, office_bonus REAL DEFAULT 0,
      advance_deduct REAL DEFAULT 0, fine REAL DEFAULT 0, equipment REAL DEFAULT 0, fund REAL DEFAULT 0,
      remaining REAL DEFAULT 0, remaining_net REAL DEFAULT 0,
      wallet TEXT DEFAULT '', wallet_type TEXT DEFAULT '',
      status TEXT DEFAULT '', uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_payroll_rider ON payroll(rider_id, period)');
  db.run('CREATE INDEX IF NOT EXISTS idx_payroll_file ON payroll(file_id)');

  // طلبات الحضور والانصراف من صفحة المندوب — بتتحوّل للمشرف في الروستر والموافقة
  // بتسجّل الحضور رسمي هناك. النسخة هنا للعرض السريع لحالة الطلب للمندوب.
  db.run(`
    CREATE TABLE IF NOT EXISTS att_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      das_code TEXT NOT NULL,
      courier_name TEXT DEFAULT '',
      roster_req_id INTEGER,
      attendance_date TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT DEFAULT 'Pending',
      requested_at TEXT,
      device_time TEXT DEFAULT '',
      roster_decided_at TEXT,
      decision_note TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // طلب واحد Pending من نفس النوع لنفس المندوب في نفس يوم الشيفت — التكرار مقفول
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS uq_att_pending
          ON att_requests(das_code, attendance_date, action) WHERE status = 'Pending'`);
  db.run('CREATE INDEX IF NOT EXISTS idx_att_code ON att_requests(das_code, id)');

  // جرس تنبيهات المندوب — الإشعارات المحفوظة (بتندمج غير المقروءة لنفس المرجع)
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      das_code TEXT NOT NULL,
      kind TEXT DEFAULT '',
      title TEXT NOT NULL,
      body TEXT DEFAULT '',
      ref TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      read_at DATETIME
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_notif_code ON notifications(das_code, id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(das_code, read_at)');

  // محادثة كل شكوى: الأدمن والمندوب بيتكلموا جوه نفس التذكرة بدل ما يفتحوا شكوى جديدة
  db.run(`
    CREATE TABLE IF NOT EXISTS ticket_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      seen_admin INTEGER DEFAULT 0,
      seen_courier INTEGER DEFAULT 0
    )
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_tmsg_ticket ON ticket_messages(ticket_id, id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_tmsg_unread_admin ON ticket_messages(ticket_id, seen_admin)');

  // قاعدة قديمة؟ نزود الأعمدة الناقصة تلقائي (بعد إنشاء الجدول)
  db.all("PRAGMA table_info(payroll)", [], (pErr, pCols) => {
    if (pErr || !pCols) return;
    const names = pCols.map(c => c.name);
    if (!names.includes('sp')) db.run("ALTER TABLE payroll ADD COLUMN sp TEXT DEFAULT ''");
  });

  // قاعدة قديمة؟ نزود الأعمدة الناقصة تلقائي (بعد إنشاء الجدول)  // الكروت: sort_order للترتيب بالسحب والإفلات — الموجودين قبل التحديث بنرتّبهم
  // بنفس ترتيب العرض القديم (الأحدث أولان) عشان ما يتغيّرش شكل الصفحة فجأة.
  db.all("PRAGMA table_info(cards)", (cErr, cCols) => {
    if (cErr || !cCols) return;
    if (!cCols.some(c => c.name === 'sort_order')) {
      db.run("ALTER TABLE cards ADD COLUMN sort_order INTEGER DEFAULT 0", (aErr) => {
        if (aErr) return;
        db.all("SELECT id FROM cards ORDER BY id DESC", [], (rErr, rows) => {
          if (rErr || !rows) return;
          let i = 0;
          const step = () => {
            if (i >= rows.length) return;
            db.run("UPDATE cards SET sort_order = ? WHERE id = ?", [i, rows[i].id], () => { i++; step(); });
          };
          step();
        });
      });
    }
    if (!cCols.some(c => c.name === 'choices')) {
      db.run("ALTER TABLE cards ADD COLUMN choices TEXT DEFAULT ''");
    }
  });
  db.all("PRAGMA table_info(tickets)", (err, cols) => {
    if (err || !cols) return;
    if (!cols.some(c => c.name === 'archived')) {
      db.run("ALTER TABLE tickets ADD COLUMN archived INTEGER DEFAULT 0");
    }
    if (!cols.some(c => c.name === 'rating')) {
      db.run("ALTER TABLE tickets ADD COLUMN rating INTEGER");
      db.run("ALTER TABLE tickets ADD COLUMN rating_note TEXT DEFAULT ''");
      db.run("ALTER TABLE tickets ADD COLUMN rated_at DATETIME");
    }
    if (!cols.some(c => c.name === 'seen_note')) {
      db.run("ALTER TABLE tickets ADD COLUMN seen_note TEXT DEFAULT ''");
      db.run("ALTER TABLE tickets ADD COLUMN seen_at DATETIME");
    }
    // الإقفال النهائي للشكوى (المحادثة بتتقفل ومفيش ردود جديدة غير بعد إعادة الفتح)
    if (!cols.some(c => c.name === 'closed_at')) {
      db.run("ALTER TABLE tickets ADD COLUMN closed_at DATETIME");
      db.run("ALTER TABLE tickets ADD COLUMN closed_by TEXT DEFAULT ''");
    }
  });
});

// إرسال إشعار لكل أجهزة مندوب معين — فشل الاشتراك القديم (404/410) بيتمسح لوحده
function sendPush(dasCode, title, body) {
  if (!pushEnabled || !dasCode) return;
  db.all("SELECT id, endpoint, p256dh, auth FROM push_subs WHERE das_code = ?", [String(dasCode).toUpperCase()], (err, subs) => {
    if (err || !subs || !subs.length) return;
    const payload = JSON.stringify({ title: String(title || 'DAS Portal'), body: String(body || '').slice(0, 200), url: '/index.html' });
    subs.forEach((s) => {
      webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        .catch((e) => {
          if (e && (e.statusCode === 404 || e.statusCode === 410)) {
            db.run("DELETE FROM push_subs WHERE id = ?", [s.id]);
          }
        });
    });
  });
}

// ================= باص الأحداث (لايف) =================
// أي عملية كتابة بتنشر حدث هنا، والتابات المتصلة بتستنى على /api/events
// (long-poll) فبيوصلها التغيير في نفس اللحظة من غير أي refresh من المستخدم.
// الأحداث في الذاكرة بس: بعد إعادة تشغيل السيرفر بتبدأ من جديد، والعميل
// اللي كان متصل بياخد reset ويعمل تحديث كامل مرة واحدة.
class EventBus {
  constructor(keep = 200) { this.rev = 0; this.keep = keep; this.list = []; this.waiters = new Set(); }
  publish(kind, data = {}) {
    this.rev += 1;
    const ev = Object.assign({ rev: this.rev, kind, at: new Date().toISOString() }, data);
    this.list.push(ev);
    if (this.list.length > this.keep) this.list.splice(0, this.list.length - this.keep);
    const waiters = [...this.waiters]; this.waiters.clear();
    waiters.forEach((w) => { try { w(); } catch (e) {} });
    return ev;
  }
  since(rev) { return this.list.filter((e) => e.rev > rev); }
}
const BUS = new EventBus();

// البصمة الوحيدة في السيرفر لكل التابات — أي تاب بيشوف تغيير هنا بيتحرّك فورًا
app.get('/api/events', (req, res) => {
  let since = Math.max(0, Number(req.query.since) || 0);
  // wait بالثواني (زي باص الروستر): أقصى استنطار 28 ثانية قبل ما نرجّع رد فاضي
  const waitMs = Math.min(Math.max(Number(req.query.wait) || 0, 0), 28) * 1000;
  res.set('Cache-Control', 'no-store');

  // العميل مستخدم سيرفر تاني أو السيرفر اتعمل restart (his rev أعلى) — reset كامل
  if (since > BUS.rev) return res.json({ rev: BUS.rev, events: [], reset: true });

  if (since < BUS.rev) {
    if (since === 0) return res.json({ rev: BUS.rev, events: [] }); // أول اتصال — بنحدّث الرقم بس من غير إعادة أحداث قديمة
    const evs = BUS.since(since);
    // لو الأحداث القديمة اتقصت من الذاكرة: reset عشان التاب يعمل تحديث كامل
    return res.json({ rev: BUS.rev, events: evs, reset: evs.length ? false : true });
  }

  // مفيش جديد — بنستنى (long-poll) لحد حدث جديد أو مهلة
  if (!waitMs) return res.json({ rev: BUS.rev, events: [] });
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    BUS.waiters.delete(finish);
    // الحدث الجديد وصلنا أثناء الانتظار — نرجّعه فورًا من غير جولة تانية
    if (BUS.rev > since) return res.json({ rev: BUS.rev, events: BUS.since(since) });
    try { res.json({ rev: BUS.rev, events: [] }); } catch (e) { /* العميل قفل الاتصال */ }
  };
  const timer = setTimeout(finish, waitMs);
  BUS.waiters.add(finish);
  // العميل قطع الاتصال؟ نفضّي الوبي عشان الذاكرة
  res.on('close', () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    BUS.waiters.delete(finish);
  });
});

// ================= الإشعارات الذكية المحفوظة =================
// سطر تنبيه لكل مندوب يفضّل معاه في جرس تنبيهاته حتى لو قفل الصفحة فترة طويلة،
// وكمان بنبعت web-push لأجهزته. التنبيهات غير المقروءة لنفس المرجع (نفس الشكوى/السلفة/ملف القبض)
// بتندمج في سطر واحد بآخر تحديث بدل ما الكومة تكرر نفس الحاجة، والقديمة المقروءة بتتنضف تلقائيًا.
function notifyCourier(dasCode, title, body, opts = {}) {
  const code = String(dasCode || '').trim().toUpperCase();
  if (!code || !title) return;
  const kind = String(opts.kind || '');
  const ref = String(opts.ref || '');
  const t = String(title).slice(0, 120);
  const b = String(body || '').slice(0, 200);

  db.run(
    "UPDATE notifications SET title = ?, body = ?, kind = ?, created_at = CURRENT_TIMESTAMP, read_at = NULL WHERE das_code = ? AND ref = ? AND ref != '' AND read_at IS NULL",
    [t, b, kind, code, ref],
    function (uErr) {
      if (uErr) return;
      if (this.changes > 0) return; // تندمج في التنبيه غير المقروء الموجود
      db.run("INSERT INTO notifications (das_code, kind, title, body, ref) VALUES (?, ?, ?, ?, ?)",
        [code, kind, t, b, ref],
        (iErr) => {
          if (iErr) return;
          // تنظيف تلقائي: آخر 60 تنبيه بس لكل مندوب + المقروء الأقدم من 30 يوم
          db.run("DELETE FROM notifications WHERE das_code = ? AND (id NOT IN (SELECT id FROM notifications WHERE das_code = ? ORDER BY id DESC LIMIT 60) OR (read_at IS NOT NULL AND created_at < datetime('now', '-30 days')))",
            [code, code], () => {});
        });
    }
  );
  sendPush(code, t, b);
  BUS.publish('notify', { das_code: code, title: t, body: b, notif_kind: kind });
}

// إشعار قبض ذكي: لكل مندوب ليه صف في الملف المرفوع (بنفس مطابقة شاشة القبض:
// Rider ID = كود المندوب، وإلا مطابقة الاسم) — بيتبعت مرة واحدة لكل مندوب لكل ملف.
function notifyPayrollTargets(parsed, fileId, fileTitle) {
  if (!Array.isArray(parsed) || !parsed.length) return;
  const byCode = new Map();
  const byName = new Map();
  parsed.forEach((r) => {
    const code = String(r.rider_id || '').trim().toUpperCase();
    if (code && !byCode.has(code)) byCode.set(code, r);
    const name = String(r.rider_name || '').trim().toLowerCase();
    if (name && !byName.has(name)) byName.set(name, r);
  });
  db.all("SELECT das_code, name FROM couriers", [], (err, couriers) => {
    if (err || !couriers || !couriers.length) return;
    couriers.forEach((c) => {
      const code = String(c.das_code || '').trim().toUpperCase();
      const row = byCode.get(code) || byName.get(String(c.name || '').trim().toLowerCase());
      if (!row) return;
      const net = Number(row.remaining_net != null && row.remaining_net !== '' ? row.remaining_net : row.remaining);
      const body = fileTitle + ' — الصافي: ' + (Number.isFinite(net) ? net.toFixed(0) : '0') + ' ج';
      notifyCourier(code, 'تفاصيل قبضك وصلت', body, { kind: 'payroll', ref: 'payroll:' + fileId + ':' + code });
    });
  });
}

// إشعار الكروت: لما الأدمن ينزل كارت جديد (أو يعدّل محتواه/يفعّله) بيوصل تنبيه
// للمناديب المستهدفين بنفس شروط ظهور الكارت بالظبط (الكل / كود / فرع / نوع دوام / فرع+نوع)
// وفي فترته — يعني اللي هيشوف الكارت في صفحته هو اللي يتنبّه.
async function notifyCardTargets(card) {
  if (!card || !card.title) return;
  const today = new Date().toISOString().slice(0, 10);
  if (card.start_date && today < card.start_date) return;
  if (card.end_date && today > card.end_date) return;

  const title = 'إعلان جديد من الإدارة';
  const body = String(card.title).slice(0, 160);
  const ref = 'card:' + card.id;
  const push = (code) => { if (code) notifyCourier(code, title, body, { kind: 'card', ref }); };

  const audience = String(card.audience || 'all');
  const value = String(card.audience_value || '');

  if (audience === 'code') {
    value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean).forEach(push);
    return;
  }

  const codes = await new Promise((resolve) => {
    db.all("SELECT das_code FROM couriers", [], (err, rows) => {
      resolve(!err && rows ? rows.map((r) => String(r.das_code || '').toUpperCase()).filter(Boolean) : []);
    });
  });
  if (audience === 'all') { codes.forEach(push); return; }

  // فرع/نوع دوام: نفس مطابقة صفحة المندوب — محتاجة بيانات الروستر
  if (!rosterConfigured()) return;
  let emps = [];
  try { emps = await rosterEmployees(); } catch (e) { return; }
  const norm = (v) => String(v || '').trim().toUpperCase();
  const empByCode = new Map();
  (emps || []).forEach((e) => {
    const c = String(e.employee_code || '').trim().toUpperCase();
    if (c) empByCode.set(c, e);
  });
  codes.forEach((code) => {
    const emp = empByCode.get(code);
    if (!emp) return;
    if (audience === 'branch' && norm(emp.branch) === norm(value)) push(code);
    else if (audience === 'type' && norm(emp.employment_type) === norm(value)) push(code);
    else if (audience === 'branch_type') {
      const parts = value.split('|');
      if (norm(emp.branch) === norm(parts[0]) && norm(emp.employment_type) === norm(parts[1])) push(code);
    }
  });
}

// ================= API للمندوب =================

// 1. تسجيل دخول المندوب بالكود (DAS Login)
// تحميل تطبيق المندوب مباشرة من دومين البوابة.
// بنمرّر الملف من السيرفر بدل التحويل، عشان Service Worker تطبيق الطابور
// مايقدرش يعترض اللينك ويرجّع صفحة HTML بدل ملف التطبيق.
const APP_APK_URL = process.env.APP_APK_URL || 'https://bankai-smart-queue-api-production.up.railway.app/app';
app.get('/app', async (req, res) => {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    const upstream = await fetch(APP_APK_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!upstream.ok) return res.status(502).send('download unavailable');
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="Bankai-Smart.apk"');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (e) {
    res.status(502).send('download unavailable');
  }
});

app.post('/api/courier/login', (req, res) => {
  if (rateLimited(req, 'courier-login', 5, 60e3)) return res.status(429).json({ error: 'محاولات كتير — استنى دقيقة وجرب تاني' });
  const { das_code } = req.body || {};
  if (!das_code) return res.status(400).json({ error: 'يرجى إدخال الكود' });

  const cleanCode = String(das_code).trim().toUpperCase();
  db.get("SELECT * FROM couriers WHERE UPPER(das_code) = ?", [cleanCode], (err, courier) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!courier) return res.status(404).json({ error: 'كود المندوب غير مسجل في السيستم' });
    res.json({ courier });
  });
});

// 2. جلب شكاوى المندوب الخاصة به — وبتسجل معاها إنه شاف آخر رد من الإدارة
// (لو الرد اتغير بعدها، وصلته "مش شافها" تاني لحد ما يفتح التاب)
// ================= تطبيق المندوب (Bankai Smart) =================
const APP_AUDIENCES = ['all', 'branch', 'type', 'branch_type', 'code'];
const APP_DEFAULT_URL = 'https://bankai-smart-queue-api-production.up.railway.app/app';

function appReleasePayload(b) {
  const enabled = !!(b && b.enabled);
  const title = String((b && b.title) || '').trim().slice(0, 80) || 'تطبيق Bankai Smart';
  const body = String((b && b.body) || '').trim().slice(0, 300);
  let url = String((b && b.apk_url) || '').trim() || APP_DEFAULT_URL;
  if (!/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) return { error: 'رابط التطبيق غير صحيح' };
  const version = String((b && b.version) || '').trim().slice(0, 30);
  const audience = APP_AUDIENCES.includes(b && b.audience) ? b.audience : 'all';
  let value = String((b && b.audience_value) || '').trim();

  if (audience === 'branch') {
    if (!['QCD 1', 'QCD 2'].includes(value)) return { error: 'الفرع لازم يكون QCD 1 أو QCD 2' };
  } else if (audience === 'type') {
    if (!['FT', 'PT'].includes(value)) return { error: 'نوع الدوام لازم يكون FT أو PT' };
  } else if (audience === 'branch_type') {
    const parts = value.split('|');
    const br = String(parts[0] || '').trim().toUpperCase();
    const ty = String(parts[1] || '').trim().toUpperCase();
    if (!['QCD 1', 'QCD 2'].includes(br)) return { error: 'الفرع لازم يكون QCD 1 أو QCD 2' };
    if (!['FT', 'PT'].includes(ty)) return { error: 'نوع الدوام لازم يكون FT أو PT' };
    value = br + '|' + ty;
  } else if (audience === 'code') {
    const codes = [...new Set(value.split(/[,;\n]+/).map((s) => s.trim().toUpperCase()).filter(Boolean))];
    if (!codes.length) return { error: 'اكتب كود مندوب واحد على الأقل' };
    if (codes.length > 300) return { error: 'الحد الأقصى 300 كود' };
    value = codes.join(',');
  } else {
    value = '';
  }

  return { enabled, title, body, url, version, audience, value };
}

async function appReleaseFor(code) {
  const cfg = await new Promise((resolve) => {
    db.get("SELECT * FROM app_release WHERE id = 1", [], (err, row) => resolve(err ? null : row));
  });
  if (!cfg || !cfg.enabled) return { show: false };
  const url = String(cfg.apk_url || '').trim();
  if (!url) return { show: false };

  const base = {
    show: true,
    title: String(cfg.title || 'تطبيق Bankai Smart'),
    body: String(cfg.body || ''),
    version: String(cfg.version || ''),
    url
  };
  const audience = String(cfg.audience || 'all');
  const value = String(cfg.audience_value || '');
  const norm = (v) => String(v || '').trim().toUpperCase();

  if (audience === 'all') return base;
  if (audience === 'code') {
    const codes = value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    return codes.includes(norm(code)) ? base : { show: false };
  }

  // فروع/نوع الدوام بتتحدد من ملف الروستر المسحوب من نظام الحضور
  if (!rosterConfigured()) return { show: false };
  let emps = [];
  try {
    emps = await rosterEmployees();
  } catch (e) {
    return { show: false };
  }
  const emp = (emps || []).find((e) => norm(e.employee_code) === norm(code));
  if (!emp) return { show: false };
  if (audience === 'branch') return norm(emp.branch) === norm(value) ? base : { show: false };
  if (audience === 'type') return norm(emp.employment_type) === norm(value) ? base : { show: false };
  if (audience === 'branch_type') {
    const parts = value.split('|');
    return norm(emp.branch) === norm(parts[0]) && norm(emp.employment_type) === norm(parts[1])
      ? base
      : { show: false };
  }
  return { show: false };
}

app.get('/api/courier/app-release/:das_code', async (req, res) => {
  const code = String(req.params.das_code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'كود المندوب مطلوب' });
  try {
    res.json(await appReleaseFor(code));
  } catch (e) {
    res.status(500).json({ error: 'خطأ في السيرفر' });
  }
});

app.get('/api/courier/tickets/:das_code', (req, res) => {
  const cleanCode = String(req.params.das_code || '').trim().toUpperCase();
  db.run(
    `UPDATE tickets SET seen_note = admin_note, seen_at = CURRENT_TIMESTAMP
     WHERE UPPER(das_code) = ? AND admin_note != '' AND (seen_note IS NULL OR seen_note != admin_note)`,
    [cleanCode],
    () => {
      db.all(
        `SELECT t.*,
           (SELECT COUNT(*) FROM ticket_messages m
             WHERE m.ticket_id = t.id AND m.sender = 'admin' AND m.seen_courier = 0) AS chat_unread
         FROM tickets t WHERE UPPER(t.das_code) = ? ORDER BY t.id DESC`,
        [cleanCode],
        (err, rows) => {
          if (err) return res.status(500).json({ error: 'خطأ في جلب البيانات' });
          res.json({ tickets: rows });
        }
      );
    }
  );
});

// 3. إرسال شكوى جديدة من المندوب — الكود لازم يكون مسجل، والاسم بيتاخد من الداتابيز مش من العميل
app.post('/api/tickets', (req, res) => {
  if (rateLimited(req, 'ticket-post', 12, 60e3)) return res.status(429).json({ error: 'طلبات كتير — استنى شوية وجرب تاني' });
  const { das_code, category, sub_type, issue_date, description } = req.body || {};
  if (!das_code || !category || !description) {
    return res.status(400).json({ error: 'يرجى ملء جميع البيانات المطلوبة' });
  }

  const cleanCode = String(das_code).trim().toUpperCase();
  db.get("SELECT name FROM couriers WHERE UPPER(das_code) = ?", [cleanCode], (err, row) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!row) return res.status(404).json({ error: 'كود المندوب غير مسجل في السيستم' });

    const stmt = db.prepare(`
      INSERT INTO tickets (das_code, courier_name, category, sub_type, issue_date, description, status)
      VALUES (?, ?, ?, ?, ?, ?, 'يتم المراجعة')
    `);

    stmt.run(
      [cleanCode, row.name, String(category), String(sub_type || 'عام'), String(issue_date || '-'), String(description)],
      function (err2) {
        if (err2) return res.status(500).json({ error: 'فشل تسجيل الشكوى' });
        res.json({ success: true, ticket_id: this.lastID });
        BUS.publish('tickets', { das_code: cleanCode, id: this.lastID, reason: 'new' });
      }
    );
  });
});

// 3-ج. محادثة الشكوى للمندوب — بيرجّع الرسايل وبيعلّم ردود الإدارة كمقروءة
app.get('/api/courier/tickets/:id/messages', (req, res) => {
  const ticketId = Number(req.params.id);
  const cleanCode = String(req.query.das_code || '').trim().toUpperCase();
  if (!Number.isFinite(ticketId) || !cleanCode) return res.status(400).json({ error: 'بيانات ناقصة' });
  db.get("SELECT * FROM tickets WHERE id = ?", [ticketId], (err, t) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!t) return res.status(404).json({ error: 'الشكوى غير موجودة' });
    if (String(t.das_code || '').toUpperCase() !== cleanCode) return res.status(403).json({ error: 'الشكوى دي مش بتاعتك' });

    db.run("UPDATE ticket_messages SET seen_courier = 1 WHERE ticket_id = ? AND sender = 'admin' AND seen_courier = 0", [ticketId], () => {
      db.all("SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id ASC", [ticketId], (e2, rows) => {
        if (e2) return res.status(500).json({ error: 'خطأ في جلب المحادثة' });
        res.set('Cache-Control', 'no-store');
        res.json({
          messages: rows || [],
          closed: !!t.closed_at,
          closed_at: t.closed_at || null,
          status: t.status
        });
      });
    });
  });
});

// 3-د. رد المندوب في المحادثة — لازم يكون صاحب الشكوى والموضوع مش مقفول
app.post('/api/courier/tickets/:id/messages', (req, res) => {
  if (rateLimited(req, 'ticket-chat', 40, 60e3)) return res.status(429).json({ error: 'رسايل كتير — استنى دقيقة وجرب تاني' });
  const ticketId = Number(req.params.id);
  const { das_code } = req.body || {};
  const cleanCode = String(das_code || '').trim().toUpperCase();
  const body = String((req.body || {}).body || '').trim().slice(0, 1000);
  if (!Number.isFinite(ticketId) || !cleanCode) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (!body) return res.status(400).json({ error: 'اكتب رسالتك الأول' });

  db.get("SELECT * FROM tickets WHERE id = ?", [ticketId], (err, t) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!t) return res.status(404).json({ error: 'الشكوى غير موجودة' });
    if (String(t.das_code || '').toUpperCase() !== cleanCode) return res.status(403).json({ error: 'الشكوى دي مش بتاعتك' });
    if (t.closed_at) return res.status(409).json({ error: 'الشكوى دي مقفولة نهائيًا — كلم الإدارة لو محتاج حاجة تانية' });

    db.run("INSERT INTO ticket_messages (ticket_id, sender, body, seen_admin, seen_courier) VALUES (?, 'courier', ?, 0, 1)",
      [ticketId, body],
      function (e2) {
        if (e2) return res.status(500).json({ error: 'فشل إرسال الرسالة' });
        db.run("UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [ticketId], () => {});
        BUS.publish('ticket-chat', { ticket_id: ticketId, das_code: t.das_code, sender: 'courier' });
        res.json({ success: true, id: this.lastID });
      });
  });
});

// 3-ب. تقييم حل الشكوى — للمندوب صاحب الشكوى بس، وبعد ما تكون "اتحلت"
app.put('/api/tickets/:id/rate', (req, res) => {
  if (rateLimited(req, 'ticket-rate', 20, 60e3)) return res.status(429).json({ error: 'محاولات كتير — استنى دقيقة وجرب تاني' });
  const { das_code, rating, rating_note } = req.body || {};
  const ticketId = req.params.id;

  const r = Number(rating);
  if (!Number.isInteger(r) || r < 1 || r > 5) {
    return res.status(400).json({ error: 'التقييم لازم يكون رقم من 1 لـ 5' });
  }
  const note = String(rating_note || '').slice(0, 200);

  db.get("SELECT * FROM tickets WHERE id = ?", [ticketId], (err, ticket) => {
    if (err || !ticket) return res.status(404).json({ error: 'الشكوى غير موجودة' });
    const cleanCode = String(das_code || '').trim().toUpperCase();
    if (ticket.das_code !== cleanCode) return res.status(403).json({ error: 'الشكوى دي مش بتاعتك' });
    if (ticket.status !== 'اتحلت') return res.status(400).json({ error: 'مفيش تقييم غير بعد ما الشكوى تتحل' });

    db.run(
      "UPDATE tickets SET rating = ?, rating_note = ?, rated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [r, note, ticketId],
      (err2) => {
        if (err2) return res.status(500).json({ error: 'فشل حفظ التقييم' });
        res.json({ success: true });
        BUS.publish('tickets', { das_code: ticket.das_code, id: ticket.id, reason: 'rated' });
      }
    );
  });
});

// 4. طلب سلفة من المندوب — الكود لازم يكون مسجل، والاسم بيتاخد من الداتابيز
app.post('/api/advances', (req, res) => {
  if (rateLimited(req, 'advance-post', 12, 60e3)) return res.status(429).json({ error: 'طلبات كتير — استنى شوية وجرب تاني' });
  const { das_code, amount, reason, wallet } = req.body || {};
  if (!das_code || !reason || !wallet) {
    return res.status(400).json({ error: 'يرجى ملء جميع البيانات المطلوبة' });
  }
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1000000) {
    return res.status(400).json({ error: 'المبلغ غير صحيح' });
  }

  const cleanCode = String(das_code).trim().toUpperCase();
  db.get("SELECT name FROM couriers WHERE UPPER(das_code) = ?", [cleanCode], (err, row) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!row) return res.status(404).json({ error: 'كود المندوب غير مسجل في السيستم' });

    const stmt = db.prepare(`
      INSERT INTO advances (das_code, courier_name, amount, reason, wallet)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      [cleanCode, row.name, amt, String(reason), String(wallet).trim()],
      function (err2) {
        if (err2) return res.status(500).json({ error: 'فشل تسجيل طلب السلفة' });
        res.json({ success: true, advance_id: this.lastID });
        BUS.publish('advances', { das_code: cleanCode, id: this.lastID, reason: 'new' });
      }
    );
  });
});

// 5. جلب سلف المندوب الخاصة به
app.get('/api/courier/advances/:das_code', (req, res) => {
  const cleanCode = String(req.params.das_code || '').trim().toUpperCase();
  db.all(
    "SELECT * FROM advances WHERE UPPER(das_code) = ? ORDER BY id DESC",
    [cleanCode],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'خطأ في جلب البيانات' });
      res.json({ advances: rows });
    }
  );
});

// 5-أ. تفاصيل القبض للمندوب — صفوف الملفات اللي فيها Rider ID بتاعه (أو مطابقة بالاسم)
app.get('/api/courier/payroll/:das_code', (req, res) => {
  const cleanCode = String(req.params.das_code || '').trim().toUpperCase();
  const name = String(req.query.name || '').trim();
  const sel = `SELECT p.*, f.title AS file_title, f.uploaded_at AS file_uploaded_at
                 FROM payroll p LEFT JOIN payroll_files f ON f.id = p.file_id`;
  db.all(`${sel} WHERE UPPER(p.rider_id) = ? ORDER BY p.period DESC, p.id DESC`, [cleanCode], (err, rows) => {
    if (err) { console.error('[DAS] payroll read:', err.message); return res.status(500).json({ error: 'خطأ في جلب تفاصيل القبض' }); }
    if (rows.length || !name) return res.json({ payroll: rows, matched_by: 'code' });
    db.all(`${sel} WHERE LOWER(TRIM(p.rider_name)) = LOWER(TRIM(?)) ORDER BY p.period DESC, p.id DESC`, [name], (err2, rows2) => {
      if (err2) return res.status(500).json({ error: 'خطأ في جلب تفاصيل القبض' });
      res.json({ payroll: rows2, matched_by: rows2.length ? 'name' : 'none' });
    });
  });
});

// 26. جرس تنبيهات المندوب — آخر 60 إشعار + عدد اللي لسه مش مقروء
app.get('/api/courier/notifications/:das_code', (req, res) => {
  const cleanCode = String(req.params.das_code || '').trim().toUpperCase();
  db.all("SELECT * FROM notifications WHERE das_code = ? ORDER BY id DESC LIMIT 60", [cleanCode], (err, rows) => {
    if (err) return res.status(500).json({ error: 'خطأ في جلب التنبيهات' });
    db.get("SELECT COUNT(*) AS n FROM notifications WHERE das_code = ? AND read_at IS NULL", [cleanCode], (e2, cnt) => {
      if (e2) return res.status(500).json({ error: 'خطأ في جلب التنبيهات' });
      res.set('Cache-Control', 'no-store');
      res.json({ notifications: rows, unread: cnt ? cnt.n : 0 });
    });
  });
});

// تعليم كل تنبيهات المندوب كمقروءة — بيتنادى لما يفتح الجرس
app.post('/api/courier/notifications/read', (req, res) => {
  const cleanCode = String((req.body || {}).das_code || '').trim().toUpperCase();
  if (!cleanCode) return res.status(400).json({ error: 'كود المندوب مطلوب' });
  db.run("UPDATE notifications SET read_at = CURRENT_TIMESTAMP WHERE das_code = ? AND read_at IS NULL", [cleanCode], (err) => {
    if (err) return res.status(500).json({ error: 'فشل تعليم التنبيهات' });
    res.json({ success: true });
  });
});

// 5-ب. رفع ملفات القبض — الأدمن: JSON rows جاهزة (الـ CSV بيتفسر في الواجهة) 
const NUM = (v) => { const n = parseFloat(String(v ?? '').replace(/[,\s]/g, '')); return isNaN(n) ? 0 : n; };

// ================= تفسير ملفات القبض (Accounting Amazon) =================
// ملفات "Accounting Amazon" بتيجي بعناوين عربية، وساعات بتيجي العناوين نفسها
// متلفة (كل العربي بيطلع "?" بعد الحفظ من برامج معينة) — فبنقراها بالاسم لو
// موجود، وإلا بنرجع لترتيب الأعمدة الثابت بتاع الفورمات. عمودي "القيمة" المكررين
// (قيمة الأوردرات + قيمة الضمان) بيتحددوا بالمكان مش بالاسم.
const PAYROLL_FIELDS = [
  ['id', 0, ['Rider ID', 'rider id', 'riderid']],
  ['name', 1, ['Rider Name', 'rider name', 'name']],
  ['sp', 2, ['SP']],
  ['zone', 3, ['Zone']],
  ['days', 4, ['عدد ايام العمل', 'عدد أيام العمل', 'ايام العمل']],
  ['orders_n', 5, ['عدد اوردرات المندوب', 'اوردرات المندوب']],
  ['order_price', 6, ['سعر الاوردر']],
  ['orders_value', 7, ['القيمة_اوردرات']],
  ['amazon_n', 8, ['عدد اوردرات امازون', 'اوردرات امازون']],
  ['guarantee_price', 9, ['سعر اوردر الضمان']],
  ['guarantee_value', 10, ['القيمة_ضمان']],
  ['salary', 11, ['مرتب الطيار']],
  ['bonus', 12, ['بونص الطيار']],
  ['distance_bonus', 13, ['بونص مسافة']],
  ['tibas', 14, ['تبس']],
  ['total_pilot', 15, ['اجمالى مرتب الطيار', 'اجمالي مرتب الطيار', 'اجمالى المرتب']],
  ['prev_taken', 16, ['قبض سابق']],
  ['office_bonus', 17, ['بونص مكتب']],
  ['advance_deduct', 18, ['سلفة الطيار', 'سلفة']],
  ['fine', 19, ['غرامة']],
  ['equipment', 20, ['معدات']],
  ['fund', 21, ['صندوق زمالة', 'صندوق']],
  ['remaining', 22, ['الباقى', 'الباقي']],
  ['remaining_net', 23, ['الباقي بعد خصم الرسوم', 'الباقى بعد خصم الرسوم']],
  ['wallet', 24, ['رقم المحفظة']],
  ['wallet_type', 25, ['نوع المحفظة']],
  ['status', 27, ['Status']]
];

function normPayrollHeader(v) {
  return String(v || '')
    .replace(/[\u0640\u064B-\u0652]/g, '')           // تطويل وتشكيل
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

function payrollHeaderIndex(headers, names) {
  const norm = headers.map(normPayrollHeader);
  const squeeze = (s) => s.replace(/\s+/g, '');
  for (const name of names) {
    const i = norm.indexOf(normPayrollHeader(name));
    if (i >= 0) return i;
  }
  for (const name of names) {
    const n = squeeze(normPayrollHeader(name));
    const i = norm.findIndex((h) => squeeze(h) === n);
    if (i >= 0) return i;
  }
  return -1;
}

// قارئ CSV متسامح: علامات تنصيص، CRLF، وBOM
function splitCsvRows(text) {
  const rows = []; let cur = []; let field = ''; let inQ = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += ch;
      continue;
    }
    if (ch === '"') { inQ = true; continue; }
    if (ch === ',') { cur.push(field); field = ''; continue; }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      cur.push(field); rows.push(cur); cur = []; field = '';
      continue;
    }
    field += ch;
  }
  if (field !== '' || cur.length) { cur.push(field); rows.push(cur); }
  return rows.filter((r) => r.length > 1 || String(r[0] || '').trim() !== '');
}

// CSV → صفوف بالشكل اللي norm() بيفهمه
function parsePayrollCsv(text) {
  const rows = splitCsvRows(String(text || '').replace(/^\uFEFF/, ''));
  if (rows.length < 2) return { rows: [], error: 'الملف فاضي أو مفيهوش صفوف' };
  const headers = rows[0].map((h) => String(h == null ? '' : h).trim());
  const idx = {};
  for (const [key, pos, names] of PAYROLL_FIELDS) {
    let i = payrollHeaderIndex(headers, names);
    if (i < 0) i = pos;                       // العناوين متلفة أو مش موجودة؟ ترتيب الفورمات
    idx[key] = i;
  }
  const out = [];
  for (const r of rows.slice(1)) {
    const get = (key) => { const i = idx[key]; return i >= 0 && r[i] != null ? String(r[i]).trim() : ''; };
    if (!get('id') && !get('name')) continue;  // صفوف فاضية
    out.push({
      'Rider ID': get('id'), 'Rider Name': get('name'), SP: get('sp'), Zone: get('zone'),
      'عدد ايام العمل': get('days'), 'عدد اوردرات المندوب': get('orders_n'),
      'سعر الاوردر': get('order_price'), 'القيمة_اوردرات': get('orders_value'),
      'عدد اوردرات امازون': get('amazon_n'), 'سعر اوردر الضمان': get('guarantee_price'),
      'القيمة_ضمان': get('guarantee_value'), 'مرتب الطيار': get('salary'),
      'بونص الطيار': get('bonus'), 'بونص مسافة': get('distance_bonus'), 'تبس': get('tibas'),
      'اجمالى مرتب الطيار': get('total_pilot'), 'قبض سابق': get('prev_taken'),
      'بونص مكتب': get('office_bonus'), 'سلفة الطيار': get('advance_deduct'),
      'غرامة': get('fine'), 'معدات': get('equipment'), 'صندوق زمالة': get('fund'),
      'الباقى': get('remaining'), 'الباقي بعد خصم الرسوم': get('remaining_net'),
      'رقم المحفظة': get('wallet'), 'نوع المحفظة': get('wallet_type'),
      Status: get('status')
    });
  }
  if (!out.length) return { rows: [], error: 'الملف مفيهوش صفوف صالحة (Rider ID أو الاسم فاضي في كل الصفوف؟)' };
  return { rows: out };
}

app.post('/api/admin/payroll/upload', express.json({ limit: '6mb' }), (req, res) => {
  if (!safeEq(String(req.headers['x-admin-token'] || ''), ADMIN_TOKEN)) return res.status(401).json({ error: 'غير مصرح' });
  if (rateLimited(req, 'payroll-upload', 30, 60e3)) return res.status(429).json({ error: 'محاولات كتير — استنى دقيقة' });

  const { title = '', period = '', zone = '' } = req.body || {};
  let rows = req.body && req.body.rows;
  // المتصفح بيبعت الملف خام (csv) والسيرفر بيفسّره — كده العناوين العربية المتلفة
  // (???) ما بتوقفش الرفع، والتفسير واحد لكل المستخدمين. صفوف JSON القديمة لسه مدعومة.
  if (!Array.isArray(rows)) {
    if (typeof (req.body && req.body.csv) === 'string') {
      const parsed = parsePayrollCsv(req.body.csv);
      if (!parsed.rows.length) return res.status(400).json({ error: parsed.error || 'الملف مفيهوش صفوف صالحة' });
      rows = parsed.rows;
    }
  }
  if (!rows || !Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'مفيش صفوف لرفعها' });
  if (rows.length > 500) return res.status(400).json({ error: 'الملف كبير جدًا (أكتر من 500 صف)' });

  const norm = (row) => ({
    period: String(period || row.Zone || '').trim() || String(row.Zone || '').trim(),
    zone: String(row.Zone || '').trim(), sp: String(row.SP || '').trim(),
    rider_id: String(row['Rider ID'] || '').trim().toUpperCase(),
    rider_name: String(row['Rider Name'] || '').trim(),
    days: NUM(row['عدد ايام العمل']), orders_n: NUM(row['عدد اوردرات المندوب']),
    order_price: NUM(row['سعر الاوردر']), orders_value: NUM(row['القيمة_اوردرات']),
    amazon_n: NUM(row['عدد اوردرات امازون']), guarantee_price: NUM(row['سعر اوردر الضمان']),
    guarantee_value: NUM(row['القيمة_ضمان']), salary: NUM(row['مرتب الطيار']),
    bonus: NUM(row['بونص الطيار']), distance_bonus: NUM(row['بونص مسافة']), tibas: NUM(row['تبس']),
    total_pilot: NUM(row['اجمالى مرتب الطيار']), prev_taken: NUM(row['قبض سابق']),
    office_bonus: NUM(row['بونص مكتب']), advance_deduct: NUM(row['سلفة الطيار']),
    fine: NUM(row['غرامة']), equipment: NUM(row['معدات']), fund: NUM(row['صندوق زمالة']),
    remaining: NUM(row['الباقى']), remaining_net: NUM(row['الباقي بعد خصم الرسوم']),
    wallet: String(row['رقم المحفظة'] || '').trim(), wallet_type: String(row['نوع المحفظة'] || '').trim(),
    status: String(row.Status || '').trim()
  });
  const parsed = rows.map(norm).filter(r => r.rider_id || r.rider_name);
  if (!parsed.length) return res.status(400).json({ error: 'الملف مفيهوش صفوف صالحة (Rider ID فاضي في كل الصفوف؟)' });

  db.serialize(() => {
    db.run("INSERT INTO payroll_files (title, period, zone, rows_n, uploaded_by) VALUES (?, ?, ?, ?, 'admin')",
      [String(title).trim() || 'تفاصيل القبض', String(period).trim(), String(zone).trim(), parsed.length],
      function (err) {
        if (err) { console.error('[DAS] payroll file insert:', err.message); return res.status(500).json({ error: 'فشل حفظ الملف' }); }
        const fileId = this.lastID;
        const stmt = db.prepare(`INSERT INTO payroll (file_id, period, zone, sp, rider_id, rider_name,
          days, orders_n, order_price, orders_value, amazon_n, guarantee_price, guarantee_value,
          salary, bonus, distance_bonus, tibas, total_pilot, prev_taken, office_bonus,
          advance_deduct, fine, equipment, fund, remaining, remaining_net, wallet, wallet_type, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        let failed = null;
        parsed.forEach((r) => {
          if (failed) return;
          stmt.run([fileId, r.period, r.zone, r.sp, r.rider_id, r.rider_name,
            r.days, r.orders_n, r.order_price, r.orders_value, r.amazon_n, r.guarantee_price, r.guarantee_value,
            r.salary, r.bonus, r.distance_bonus, r.tibas, r.total_pilot, r.prev_taken, r.office_bonus,
            r.advance_deduct, r.fine, r.equipment, r.fund, r.remaining, r.remaining_net, r.wallet, r.wallet_type, r.status],
            (e2) => { if (e2 && !failed) failed = e2; });
        });
        stmt.finalize(() => {
          if (failed) { console.error('[DAS] payroll rows insert:', failed.message); return res.status(500).json({ error: 'فشل حفظ صفوف القبض: ' + failed.message }); }
          res.json({ ok: true, file_id: fileId, rows: parsed.length });
          BUS.publish('payroll', { file_id: fileId, reason: 'upload' });
          notifyPayrollTargets(parsed, fileId, String(title).trim() || 'تفاصيل القبض');
        });
      });
  });
});

// 5-ج. ملفات القبض المرفوعة + حذف ملف (بصفوفه) — الأدمن
app.get('/api/admin/payroll/files', (req, res) => {
  if (!safeEq(String(req.headers['x-admin-token'] || ''), ADMIN_TOKEN)) return res.status(401).json({ error: 'غير مصرح' });
  db.all(`SELECT f.*, (SELECT COALESCE(SUM(remaining_net), 0) FROM payroll WHERE payroll.file_id = f.id) AS total_net
            FROM payroll_files f ORDER BY f.id DESC`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'خطأ في جلب الملفات' });
    res.json({ files: rows });
  });
});

app.get('/api/admin/payroll/rows/:fileId', (req, res) => {
  if (!safeEq(String(req.headers['x-admin-token'] || ''), ADMIN_TOKEN)) return res.status(401).json({ error: 'غير مصرح' });
  db.all('SELECT * FROM payroll WHERE file_id = ? ORDER BY remaining_net DESC', [Number(req.params.fileId)], (err, rows) => {
    if (err) return res.status(500).json({ error: 'خطأ في جلب الصفوف' });
    res.json({ rows });
  });
});

app.delete('/api/admin/payroll/files/:id', (req, res) => {
  if (!safeEq(String(req.headers['x-admin-token'] || ''), ADMIN_TOKEN)) return res.status(401).json({ error: 'غير مصرح' });
  db.serialize(() => {
    db.run('DELETE FROM payroll WHERE file_id = ?', [Number(req.params.id)]);
    db.run('DELETE FROM payroll_files WHERE id = ? AND id > 0', [Number(req.params.id)], function (err) {
      if (err) return res.status(500).json({ error: 'فشل الحذف' });
      res.json({ ok: true, deleted: this.changes });
      if (this.changes > 0) BUS.publish('payroll', { file_id: Number(req.params.id), reason: 'delete' });
    });
  });
});

// 5-ب. الكروت المخصصة الظاهرة للمندوب — فلترة بالجمهور (الكل/الفرع/نوع الدوام/أكواد) وبفترة السريان
// جمهور الفرع/النوع محتاج بيانات المندوب من الروستر — لو الروستر مش مربوط أو الكود مش متطابق الكروت دي بتتخفي
// ترتيب الكروت في العرض: حسب sort_order ثم الأحدث أولاً
const CARDS_ORDER = "ORDER BY sort_order ASC, id ASC";

app.get('/api/courier/cards/:das_code', async (req, res) => {
  const code = String(req.params.das_code || '').trim().toUpperCase();
  try {
    const cards = await new Promise((resolve, reject) => {
      db.all(`SELECT * FROM cards WHERE active = 1 ${CARDS_ORDER}`, [], (err, rows) => err ? reject(err) : resolve(rows));
    });
    const today = new Date().toISOString().slice(0, 10);
    let visible = cards.filter(c => (!c.start_date || today >= c.start_date) && (!c.end_date || today <= c.end_date));

    // branch_type (فرع + نوع دوام) محتاج الروست كمان — وكل الفلاتر اللي بتعتمد على بيانات المندوب
    const needRoster = visible.some(c => ['branch', 'type', 'branch_type'].includes(c.audience));
    let emp = null;
    if (needRoster && rosterConfigured()) {
      try {
        const emps = await rosterEmployees();
        const name = String(req.query.name || '').trim();
        emp = emps.find(x => String(x.employee_code || '').trim().toUpperCase() === code) ||
              (name ? emps.find(x => String(x.name || '').trim() === name) : null);
      } catch (e) { emp = null; }
    }
    // التطبيع: المقارنة مش حساسة لحالة الحروف ولا المسافات الزيادة (بيانات الروست بتنزل بصيغ مختلفة)
    const norm = (v) => String(v || '').trim().toUpperCase();

    visible = visible.filter(c => {
      if (c.audience === 'all') return true;
      if (c.audience === 'code') return String(c.audience_value || '').split(',').map(x => x.trim().toUpperCase()).includes(code);
      if (c.audience === 'branch') return !!emp && norm(emp.branch) === norm(c.audience_value);
      if (c.audience === 'type') return !!emp && norm(emp.employment_type) === norm(c.audience_value);
      if (c.audience === 'branch_type') {
        // لازم الفرع ونوع الدوام يتطابقوا مع الروستر مع بعض
        if (!emp) return false;
        const parts = String(c.audience_value || '').split('|');
        return norm(emp.branch) === norm(parts[0]) && norm(emp.employment_type) === norm(parts[1]);
      }
      return false;
    });

    // مين اختيار المندوب الحالي على كل كارت تفاعلي
    const picks = await new Promise((resolve) => {
      db.all("SELECT card_id, choice FROM card_picks WHERE das_code = ?", [code], (pErr, rows2) => pErr ? resolve([]) : resolve(rows2 || []));
    });
    const pickMap = {}; picks.forEach(p => pickMap[p.card_id] = p.choice);
    visible = visible.map(c => ({ ...c, my_pick: pickMap[c.id] }));

    res.json({ cards: visible });
  } catch (e) {
    res.status(500).json({ error: 'خطأ في جلب الكروت' });
  }
});

// ================= API للإدارة (Admin) =================

// 6. التحقق من باسورد الأدمن وتسليم التوكن
app.post('/api/admin/login', (req, res) => {
  if (rateLimited(req, 'admin-login', 5, 60e3)) return res.status(429).json({ error: 'محاولات كتير — استنى دقيقة وجرب تاني' });
  const { password } = req.body || {};
  if (safeEq(password, adminPass)) {
    res.json({ success: true, token: ADMIN_TOKEN });
  } else {
    res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  }
});

// حماية كل مسارات الأدمن بالتوكن — اللوجين مسجل فوق فمش متأثر بالحاجز ده
app.use('/api/admin', (req, res, next) => {
  if (safeEq(String(req.headers['x-admin-token'] || ''), ADMIN_TOKEN)) return next();
  res.status(401).json({ error: 'غير مصرح — سجل دخول الإدارة الأول' });
});

// إشعار موبايل تجريبي لكود مندوب — بيتبعت من هنا + بيتسجل في جرسه،
// عشان الإدارة تتأكد إن الجهاز مشترك والإشعارات شغالة (وبيرجّع عدد الأجهزة)
app.post('/api/admin/push/test', (req, res) => {
  if (!pushEnabled) return res.status(503).json({ error: 'مفاتيح الإشعارات مش متظبطة على السيرفر (PUSH_PUBLIC_KEY / PUSH_PRIVATE_KEY)' });
  const code = String((req.body || {}).das_code || '').trim().toUpperCase();
  if (!code) return res.status(400).json({ error: 'كود المندوب مطلوب' });
  db.all("SELECT id FROM push_subs WHERE das_code = ?", [code], (err, subs) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!subs || !subs.length) return res.status(404).json({ error: 'المندوب ده مفعّلش الإشعارات على أي جهاز لسه — لازم يفتح الصفحة ويضغط «تفعيل الإشعارات»' });
    notifyCourier(code, 'إشعار تجريبي 🔔', 'لو وصلتك الرسالة دي يبقى إشعارات الموبايل شغالة تمام', { kind: 'test', ref: 'test' });
    res.json({ success: true, devices: subs.length });
  });
});

// 7. جلب كل الشكاوى للإدارة (بدون المؤرشفة)
app.get('/api/admin/tickets', (req, res) => {
  sweepArchive();
  db.all(
    `SELECT t.*,
       (SELECT COUNT(*) FROM ticket_messages m
         WHERE m.ticket_id = t.id AND m.sender = 'courier' AND m.seen_admin = 0) AS chat_unread
     FROM tickets t WHERE t.archived = 0 ORDER BY t.id DESC`,
    [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'خطأ في جلب الشكاوى' });
      res.json({ tickets: rows });
    }
  );
});

// 7-ب. جلب الأرشيف (الشكاوى اللي اتحلت ومعدّي عليها 30 يوم)
app.get('/api/admin/tickets/archived', (req, res) => {
  sweepArchive();
  db.all(
    `SELECT t.*,
       (SELECT COUNT(*) FROM ticket_messages m
         WHERE m.ticket_id = t.id AND m.sender = 'courier' AND m.seen_admin = 0) AS chat_unread
     FROM tickets t WHERE t.archived = 1 ORDER BY t.id DESC`,
    [], (err, rows) => {
      if (err) return res.status(500).json({ error: 'خطأ في جلب الأرشيف' });
      res.json({ tickets: rows });
    }
  );
});

// 8. تحديث حالة الشكوى (Drop Menu) وملاحظة الإدارة — الحالة من مجموعة ثابتة بس
// وإرجاع الشكوى من الأرشيف تلقائي لو الحالة بقت مش "اتحلت"
app.put('/api/admin/tickets/:id', (req, res) => {
  const { status, admin_note } = req.body || {};
  const ticketId = req.params.id;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: 'حالة غير معروفة' });
  }

  // قبل التحديث بنجيب السطر القديم عشان نعرف إيه اللي اتغير ونقعد إشعار للمندوب
  db.get("SELECT * FROM tickets WHERE id = ?", [ticketId], (errB, before) => {
    if (errB || !before) return res.status(404).json({ error: 'الشكوى غير موجودة' });

    db.run(
      `UPDATE tickets SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP,
         archived = CASE WHEN ? = 'اتحلت' THEN archived ELSE 0 END
       WHERE id = ?`,
      [status, String(admin_note || ''), status, ticketId],
      function (err) {
        if (err) return res.status(500).json({ error: 'فشل تحديث الحالة' });
        res.json({ success: true });
        BUS.publish('tickets', { das_code: before.das_code, id: Number(ticketId) });

        const noteChanged = String(admin_note || '') !== String(before.admin_note || '');
        const statusChanged = status !== before.status;
        if (!noteChanged && !statusChanged) return;
        const note = String(admin_note || '').slice(0, 140);
        let title = 'تحديث على شكواك';
        if (statusChanged) {
          if (status === 'اتحلت') title = 'مبروك — شكواك اتحلت';
          else if (status === 'لازم تيجي المكتب') title = 'لازم تيجي المكتب بخصوص شكواك';
          else if (status === 'مرفوض') title = 'شكواك مرفوضة';
          else if (status === 'مرفوض بسبب الروستر') title = 'شكواك مرفوضة بسبب بيانات الروستر';
        } else if (noteChanged && note) {
          title = 'الإدارة ردت على شكواك';
        }
        notifyCourier(before.das_code, title, note, { kind: 'ticket', ref: 'ticket:' + ticketId });
      }
    );
  });
});

// 8-ب. محادثة الشكوى من ناحية الإدارة — الرسايل + تعليم ردود المندوب كمقروءة
app.get('/api/admin/tickets/:id/messages', (req, res) => {
  const ticketId = Number(req.params.id);
  if (!Number.isFinite(ticketId)) return res.status(400).json({ error: 'رقم الشكوى غير صحيح' });
  db.get("SELECT * FROM tickets WHERE id = ?", [ticketId], (err, t) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!t) return res.status(404).json({ error: 'الشكوى غير موجودة' });
    db.run("UPDATE ticket_messages SET seen_admin = 1 WHERE ticket_id = ? AND sender = 'courier' AND seen_admin = 0", [ticketId], () => {
      db.all("SELECT * FROM ticket_messages WHERE ticket_id = ? ORDER BY id ASC", [ticketId], (e2, rows) => {
        if (e2) return res.status(500).json({ error: 'خطأ في جلب المحادثة' });
        res.set('Cache-Control', 'no-store');
        res.json({
          messages: rows || [],
          closed: !!t.closed_at,
          closed_at: t.closed_at || null,
          ticket: { id: t.id, das_code: t.das_code, courier_name: t.courier_name, status: t.status, description: t.description, created_at: t.created_at }
        });
      });
    });
  });
});

// 8-ج. رد الإدارة في المحادثة — بيوصل للمندوب لحظيًا + إشعار محفوظ + Web Push
app.post('/api/admin/tickets/:id/messages', (req, res) => {
  if (rateLimited(req, 'admin-ticket-chat', 60, 60e3)) return res.status(429).json({ error: 'رسايل كتير — استنى دقيقة' });
  const ticketId = Number(req.params.id);
  const body = String((req.body || {}).body || '').trim().slice(0, 1000);
  if (!Number.isFinite(ticketId)) return res.status(400).json({ error: 'رقم الشكوى غير صحيح' });
  if (!body) return res.status(400).json({ error: 'اكتب ردك الأول' });

  db.get("SELECT * FROM tickets WHERE id = ?", [ticketId], (err, t) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!t) return res.status(404).json({ error: 'الشكوى غير موجودة' });
    if (t.closed_at) return res.status(409).json({ error: 'الشكوى مقفولة نهائيًا — اعمل إعادة فتح الأول لو عايز ترد' });

    db.run("INSERT INTO ticket_messages (ticket_id, sender, body, seen_admin, seen_courier) VALUES (?, 'admin', ?, 1, 0)",
      [ticketId, body],
      function (e2) {
        if (e2) return res.status(500).json({ error: 'فشل إرسال الرد' });
        db.run("UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", [ticketId], () => {});
        BUS.publish('ticket-chat', { ticket_id: ticketId, das_code: t.das_code, sender: 'admin' });
        notifyCourier(t.das_code, 'رد جديد على شكواك', body.slice(0, 160), { kind: 'ticket', ref: 'ticket:' + ticketId });
        res.json({ success: true, id: this.lastID });
      });
  });
});

// 8-د. الإقفال النهائي للشكوى / إعادة فتحها — بيقفل المحادثة على الطرفين
app.put('/api/admin/tickets/:id/close', (req, res) => {
  const ticketId = Number(req.params.id);
  const closed = !!(req.body && req.body.closed);
  if (!Number.isFinite(ticketId)) return res.status(400).json({ error: 'رقم الشكوى غير صحيح' });
  db.get("SELECT * FROM tickets WHERE id = ?", [ticketId], (err, t) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!t) return res.status(404).json({ error: 'الشكوى غير موجودة' });
    db.run(
      closed
        ? "UPDATE tickets SET closed_at = CURRENT_TIMESTAMP, closed_by = 'admin', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
        : "UPDATE tickets SET closed_at = NULL, closed_by = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [ticketId],
      (e2) => {
        if (e2) return res.status(500).json({ error: 'فشل حفظ حالة الشكوى' });
        BUS.publish('tickets', { das_code: t.das_code, id: ticketId, reason: closed ? 'close' : 'reopen' });
        BUS.publish('ticket-chat', { ticket_id: ticketId, das_code: t.das_code, reason: closed ? 'close' : 'reopen' });
        if (closed) notifyCourier(t.das_code, 'شكواك اتقفلت نهائيًا', 'لو محتاج حاجة تانية، كلم الإدارة', { kind: 'ticket', ref: 'ticket:' + ticketId });
        res.json({ success: true, closed });
      }
    );
  });
});

// 9. مسح شكوى معينة من الإدارة
app.delete('/api/admin/tickets/:id', (req, res) => {
  const ticketId = req.params.id;
  db.get("SELECT das_code FROM tickets WHERE id = ?", [ticketId], (gErr, row) => {
    db.run("DELETE FROM tickets WHERE id = ?", [ticketId], function (err) {
      if (err) return res.status(500).json({ error: 'فشل حذف الشكوى' });
      db.run("DELETE FROM ticket_messages WHERE ticket_id = ?", [ticketId], () => {});
      if (row && this.changes > 0) BUS.publish('tickets', { das_code: row.das_code, id: Number(ticketId), reason: 'delete' });
      res.json({ success: true });
    });
  });
});

// 10. إضافة مندوب جديد — الكود المكرر بيرجع خطأ بدل ما يبدّل المندوب القديم
app.post('/api/admin/couriers', (req, res) => {
  const { das_code, name, phone } = req.body || {};
  if (!das_code || !name) return res.status(400).json({ error: 'الكود والاسم مطلوبين' });

  db.run(
    "INSERT INTO couriers (das_code, name, phone) VALUES (?, ?, ?)",
    [String(das_code).trim().toUpperCase(), String(name).trim(), String(phone || '')],
    function (err) {
      if (err) {
        if (err.code === 'SQLITE_CONSTRAINT') {
          return res.status(409).json({ error: 'الكود مسجل بالفعل — استخدم رفع الشيت لتحديث الاسم' });
        }
        return res.status(500).json({ error: 'خطأ في حفظ المندوب' });
      }
      res.json({ success: true });
      BUS.publish('couriers', { reason: 'create' });
    }
  );
});

// 11. رفع شيت المناديب (CSV يحتوي على Code و Name)
// الشيت هنا هو المرجع، فالكود الموجود بيتحدث (INSERT OR REPLACE) — مخصوص عشان إعادة الرفع تحدّط الأسماء
app.post('/api/admin/upload-couriers', express.text({ type: '*/*' }), (req, res) => {
  const csvData = req.body;
  if (!csvData) return res.status(400).json({ error: 'الملف فارغ' });

  parse(csvData, { columns: true, skip_empty_lines: true, trim: true }, (err, records) => {
    if (err) return res.status(400).json({ error: 'فشل قراءة الملف. تأكد أنه ملف CSV بترميز صحيح' });

    let count = 0;
    const stmt = db.prepare("INSERT OR REPLACE INTO couriers (das_code, name) VALUES (?, ?)");

    db.serialize(() => {
      db.run("BEGIN TRANSACTION");
      records.forEach(row => {
        const code = row.Code || row.code || row.CODE || Object.values(row)[0];
        const name = row.Name || row.name || row.NAME || Object.values(row)[1];

        if (code && name) {
          stmt.run(String(code).trim().toUpperCase(), String(name).trim());
          count++;
        }
      });
      stmt.finalize();
      db.run("COMMIT", (err2) => {
        if (err2) return res.status(500).json({ error: 'خطأ في حفظ المناديب' });
        res.json({ success: true, count: count });
        BUS.publish('couriers', { reason: 'sheet', count });
      });
    });
  });
});

// 12. جلب قائمة المناديب المسجلين
app.get('/api/admin/couriers', (req, res) => {
  db.all("SELECT * FROM couriers ORDER BY das_code ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'خطأ' });
    res.json({ couriers: rows });
  });
});

// 12.b تعديل مندوب: الاسم / الكود / الموبايل
// تغيير الكود بيتحدّث في كل السجلات المرتبطة (تذاكر، سلف، اختيارات الكروت، اشعارات البوش)
// والاسم بيتحدّث في السجلات اللي فيها الاسم متكرر (عشان كل الشاشات والتقارير تبقى متسقة)
app.put('/api/admin/couriers/:das_code', (req, res) => {
  const oldCode = String(req.params.das_code || '').trim().toUpperCase();
  const body = req.body || {};
  const hasName = body.name != null;
  const hasPhone = body.phone != null;
  const newCode = String(body.das_code != null && body.das_code !== '' ? body.das_code : oldCode).trim().toUpperCase();
  const name = hasName ? String(body.name).trim() : '';
  const phone = hasPhone ? String(body.phone).trim() : '';

  if (!oldCode) return res.status(400).json({ error: 'كود المندوب مطلوب' });
  if (!newCode) return res.status(400).json({ error: 'الكود الجديد فاضي' });
  if (hasName && !name) return res.status(400).json({ error: 'الاسم فاضي' });

  const qGet = (sql, params) => new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row))));
  const qAll = (sql, params) => new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows || []))));

  // خطوات متسلسلة جوه transaction واحدة — لو أي خطوة فشلت بنعمل rollback وبنوقف
  const runTx = (steps) => new Promise((resolve, reject) => {
    db.serialize(() => {
      let i = 0;
      const next = () => {
        if (i >= steps.length) return resolve();
        const step = steps[i++];
        db.run(step.sql, step.params || [], function (err) {
          if (err) { db.run("ROLLBACK", () => reject(err)); return; }
          next();
        });
      };
      next();
    });
  });

  (async () => {
    try {
      const current = await qGet("SELECT * FROM couriers WHERE das_code = ?", [oldCode]);
      if (!current) return res.status(404).json({ error: 'المندوب مش موجود' });

      const finalName = hasName ? name : current.name;
      const finalPhone = hasPhone ? phone : (current.phone || '');
      const codeChanged = newCode !== oldCode;

      if (codeChanged) {
        const clash = await qGet("SELECT das_code FROM couriers WHERE das_code = ?", [newCode]);
        if (clash) return res.status(409).json({ error: 'الكود الجديد مسجل بالفعل لمندوب تاني' });
      }

      // كروت مظبوطة على audience = code — لازم الكود القديم يتبدّل بالجديد جواها
      const codeCards = await qAll("SELECT id, audience_value FROM cards WHERE audience = 'code'", []);
      const cardUpdates = codeCards.map(c => {
        const raw = String(c.audience_value || '');
        const parts = raw.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        if (!parts.includes(oldCode)) return null;
        const nextValue = parts.map(p => (p === oldCode ? newCode : p)).join(',');
        return nextValue === raw ? null : { id: c.id, value: nextValue };
      }).filter(Boolean);

      const steps = [{ sql: "BEGIN TRANSACTION" }];
      steps.push({ sql: "UPDATE couriers SET das_code = ?, name = ?, phone = ? WHERE das_code = ?", params: [newCode, finalName, finalPhone, oldCode] });
      if (codeChanged) {
        steps.push({ sql: "UPDATE tickets SET das_code = ? WHERE das_code = ?", params: [newCode, oldCode] });
        steps.push({ sql: "UPDATE advances SET das_code = ? WHERE das_code = ?", params: [newCode, oldCode] });
        steps.push({ sql: "UPDATE card_picks SET das_code = ? WHERE das_code = ?", params: [newCode, oldCode] });
        steps.push({ sql: "UPDATE push_subs SET das_code = ? WHERE das_code = ?", params: [newCode, oldCode] });
        cardUpdates.forEach(c => steps.push({ sql: "UPDATE cards SET audience_value = ? WHERE id = ?", params: [c.value, c.id] }));
      }
      // الاسم متكرر في السجلات — نحدّثه عشان كل الشاشات تبقى متسقة
      steps.push({ sql: "UPDATE tickets SET courier_name = ? WHERE das_code = ?", params: [finalName, newCode] });
      steps.push({ sql: "UPDATE advances SET courier_name = ? WHERE das_code = ?", params: [finalName, newCode] });
      steps.push({ sql: "UPDATE card_picks SET courier_name = ? WHERE das_code = ?", params: [finalName, newCode] });
      steps.push({ sql: "COMMIT" });

      await runTx(steps);

      const updated = await qGet("SELECT * FROM couriers WHERE das_code = ?", [newCode]);
      res.json({
        success: true,
        courier: updated,
        code_changed: codeChanged,
        name_changed: finalName !== current.name,
        old_code: oldCode
      });
      BUS.publish('couriers', { das_code: newCode, old_code: codeChanged ? oldCode : undefined, reason: codeChanged ? 'recode' : 'edit' });
    } catch (e) {
      res.status(500).json({ error: 'خطأ في حفظ التعديل: ' + (e && e.message ? e.message : '') });
    }
  })();
});

// 13. جلب كل طلبات السلف للإدارة
app.get('/api/admin/advances', (req, res) => {
  db.all("SELECT * FROM advances ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'خطأ في جلب السلف' });
    res.json({ advances: rows });
  });
});

// 14. تسجيل سلفة صرفها الأدمن بنفسه — بتتحط على "تمت الصرف" تلقائي
app.post('/api/admin/advances', (req, res) => {
  const { das_code, amount, reason, wallet, admin_note } = req.body || {};
  if (!das_code || !reason) return res.status(400).json({ error: 'الكود والسبب مطلوبين' });
  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1000000) {
    return res.status(400).json({ error: 'المبلغ غير صحيح' });
  }

  const cleanCode = String(das_code).trim().toUpperCase();
  db.get("SELECT name FROM couriers WHERE UPPER(das_code) = ?", [cleanCode], (err, row) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!row) return res.status(404).json({ error: 'كود المندوب غير مسجل في السيستم' });

    db.run(
      `INSERT INTO advances (das_code, courier_name, amount, reason, wallet, status, admin_note)
       VALUES (?, ?, ?, ?, ?, 'تمت الصرف', ?)`,
      [cleanCode, row.name, amt, String(reason), String(wallet || '').trim(), String(admin_note || '')],
      function (err2) {
        if (err2) return res.status(500).json({ error: 'فشل حفظ السلفة' });
        res.json({ success: true, advance_id: this.lastID });
        BUS.publish('advances', { das_code: cleanCode, id: this.lastID, reason: 'admin-new' });
        notifyCourier(cleanCode, 'اتسجلت سلفة ليك', 'مبلغ ' + amt + ' ج — ' + String(reason).slice(0, 120), { kind: 'advance', ref: 'advance:' + this.lastID });
      }
    );
  });
});

// 15. تحديث حالة السلفة وملاحظة الإدارة — الحالة من مجموعة ثابتة بس
app.put('/api/admin/advances/:id', (req, res) => {
  const { status, admin_note } = req.body || {};
  if (!ADV_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'حالة غير معروفة' });
  }

  db.get("SELECT * FROM advances WHERE id = ?", [req.params.id], (errB, before) => {
    if (errB || !before) return res.status(404).json({ error: 'السلفة غير موجودة' });

    db.run(
      `UPDATE advances SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [status, String(admin_note || ''), req.params.id],
      function (err) {
        if (err) return res.status(500).json({ error: 'فشل تحديث السلفة' });
        res.json({ success: true });
        BUS.publish('advances', { das_code: before.das_code, id: Number(req.params.id) });

        const noteChanged = String(admin_note || '') !== String(before.admin_note || '');
        if (status === before.status && !noteChanged) return;
        let title = 'تحديث على سلفتك';
        if (status !== before.status) {
          if (status === 'تمت الصرف') title = 'تم صرف سلفتك — ' + before.amount + ' ج';
          else if (status === 'مرفوضة') title = 'سلفتك مرفوضة';
          else if (status === 'قيد المراجعة') title = 'سلفتك قيد المراجعة';
        } else if (noteChanged && admin_note) {
          title = 'الإدارة ردت على سلفتك';
        }
        notifyCourier(before.das_code, title, String(admin_note || '').slice(0, 140), { kind: 'advance', ref: 'advance:' + before.id });
      }
    );
  });
});

// 16. مسح سلفة (لو اتسجلت بالغلط)
app.delete('/api/admin/advances/:id', (req, res) => {
  db.get("SELECT das_code FROM advances WHERE id = ?", [req.params.id], (gErr, row) => {
    db.run("DELETE FROM advances WHERE id = ?", [req.params.id], function (err) {
      if (err) return res.status(500).json({ error: 'فشل مسح السلفة' });
      if (row && this.changes > 0) BUS.publish('advances', { das_code: row.das_code, id: Number(req.params.id), reason: 'delete' });
      res.json({ success: true });
    });
  });
});

// ================= كروت صفحة المندوب (إعلانات بشروط) =================
const CARD_AUDIENCES = ['all', 'branch', 'type', 'branch_type', 'code'];

// تدقيق بيانات الكارت من الأدمن — إنشاء أو تعديل في نفس القواعد
function cardPayload(b) {
  const title = String(b.title || '').trim().slice(0, 120);
  if (!title) return { error: 'عنوان الكارت مطلوب' };

  const body = String(b.body || '').trim().slice(0, 800);
  const btnText = String(b.button_text || '').trim().slice(0, 60);
  let btnUrl = String(b.button_url || '').trim();
  if (btnUrl && !/^[a-z]+:\/\//i.test(btnUrl)) btnUrl = 'https://' + btnUrl;
  if (btnUrl && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(btnUrl)) return { error: 'رابط الزرار غير صحيح' };
  if (btnUrl && !btnText) return { error: 'لو هتحط رابط، اكتب نص للزرار' };

  const audience = CARD_AUDIENCES.includes(b.audience) ? b.audience : 'all';
  let audienceValue = String(b.audience_value || '').trim();
  if (audience === 'branch') {
    if (!['QCD 1', 'QCD 2'].includes(audienceValue)) return { error: 'الفرع لازم يكون QCD 1 أو QCD 2' };
  } else if (audience === 'type') {
    if (!['FT', 'PT'].includes(audienceValue)) return { error: 'نوع الدوام لازم يكون FT أو PT' };
  } else if (audience === 'branch_type') {
    // شرط مركب: فرع + نوع دوام مع بعض — بنخزنهم "QCD 1|FT"
    const parts = audienceValue.split('|');
    const br = String(parts[0] || '').trim().toUpperCase();
    const ty = String(parts[1] || '').trim().toUpperCase();
    if (!['QCD 1', 'QCD 2'].includes(br)) return { error: 'الفرع لازم يكون QCD 1 أو QCD 2' };
    if (!['FT', 'PT'].includes(ty)) return { error: 'نوع الدوام لازم يكون FT أو PT' };
    audienceValue = br + '|' + ty;
  } else if (audience === 'code') {
    const codes = [...new Set(audienceValue.split(/[,;\n]+/).map(s => s.trim().toUpperCase()).filter(Boolean))];
    if (!codes.length) return { error: 'اكتب كود مندوب واحد على الأقل' };
    if (codes.length > 200) return { error: 'أقصى 200 كود في الكارت' };
    audienceValue = codes.join(',');
  } else {
    audienceValue = '';
  }

  let startDate = ISO_DATE.test(String(b.start_date || '')) ? String(b.start_date) : '';
  let endDate = ISO_DATE.test(String(b.end_date || '')) ? String(b.end_date) : '';
  if (startDate && endDate && endDate < startDate) return { error: 'تاريخ النهاية لازم يكون بعد تاريخ البداية' };

  // الخيارات التفاعلية: قايمة نصوص (2 لـ 8) — لو حقل ملوش لازقة بنشيله
  let choices = [];
  if (Array.isArray(b.choices)) {
    choices = b.choices.map(c => String(c || '').trim().slice(0, 60)).filter(Boolean);
  } else if (typeof b.choices === 'string' && b.choices.trim()) {
    try {
      const parsed = JSON.parse(b.choices);
      if (Array.isArray(parsed)) choices = parsed.map(c => String(c || '').trim().slice(0, 60)).filter(Boolean);
    } catch (e) { choices = []; }
  }
  choices = [...new Set(choices)];
  if (choices.length === 1) return { error: 'لو هتحط خيارات، حط اتنين على الأقل' };
  if (choices.length > 8) return { error: 'أقصى 8 اختيارات في الكارت' };
  const choicesText = choices.length >= 2 ? JSON.stringify(choices) : '';

  return { title, body, btnText, btnUrl, audience, audienceValue, startDate, endDate, choicesText };
}

// خيارات الكارت المخزنة كنص JSON — بترجع [] لو الكارت مش تفاعلي أو النص بايظ
function cardChoices(card) {
  try {
    const p = JSON.parse((card && card.choices) || '[]');
    return Array.isArray(p) ? p.map(c => String(c == null ? '' : c)) : [];
  } catch (e) { return []; }
}

// تجميع أصوات كارت على اختياراته — عشان الأدمن يشوف مين اختار إيه
// الأصوات اليتيمة (اختيار اتشال من الكارت) مبتتحسبش — وبتتنضف من القاعدة عند الحفظ
function tallyPicks(card, picks) {
  const choices = cardChoices(card);
  const per = picks.filter(k => k.card_id === card.id && Number(k.choice) < choices.length);
  return {
    total: per.length,
    options: choices.map((label, i) => {
      const mine = per.filter((k) => Number(k.choice) === i);
      return { label, count: mine.length, who: mine.map(k => ({ das_code: k.das_code, name: k.courier_name, at: k.updated_at })) };
    })
  };
}

// 19-ب. جلب كل الكروت (شاملة المتوقفة والمستحقة تواريخها) للإدارة — بنفس ترتيب السحب والإفلات + أصوات الخيارات
// 20. تطبيق المندوب — إعدادات ظهور زر التحميل (لمين + أنهي فرع)
app.get('/api/admin/app-release', (req, res) => {
  db.get("SELECT * FROM app_release WHERE id = 1", [], (err, row) => {
    if (err) return res.status(500).json({ error: 'خطأ في القراءة' });
    res.json({ release: row || {}, default_url: APP_DEFAULT_URL });
  });
});

app.put('/api/admin/app-release', (req, res) => {
  const p = appReleasePayload(req.body || {});
  if (p.error) return res.status(400).json({ error: p.error });
  db.run(
    `UPDATE app_release SET enabled=?, title=?, body=?, apk_url=?, version=?,
       audience=?, audience_value=?, updated_at=CURRENT_TIMESTAMP WHERE id=1`,
    [p.enabled ? 1 : 0, p.title, p.body, p.url, p.version, p.audience, p.value],
    (err) => {
      if (err) return res.status(500).json({ error: 'فشل الحفظ' });
      res.json({ success: true });
      BUS.publish('app-release', { reason: 'update' });
    }
  );
});

app.get('/api/admin/cards', (req, res) => {
  db.all(`SELECT * FROM cards ${CARDS_ORDER}`, [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'خطأ في جلب الكروت' });
    db.all("SELECT card_id, das_code, courier_name, choice, updated_at FROM card_picks", [], (pErr, picks) => {
      if (pErr) picks = [];
      const cards = rows.map(c => ({ ...c, picks: tallyPicks(c, picks) }));
      res.json({ cards });
    });
  });
});

// 19-ب-1. تفاصيل كارت واحد: كل إجابة ومين اختارها — بالفرع ونوع الدوام (Full/Part)
// الفرع ونوع الدوام بييجوا من الروستر (زي شروط ظهور الكارت بالظبط). لو الروستر
// مش مربوط أو وقع، بترجع الأسماء عادي مع flag إن بيانات الروستر مش متاحة.
function promiseWithTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    Promise.resolve(promise).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}

app.get('/api/admin/cards/:id/details', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'كارت غير صحيح' });

  try {
    const card = await new Promise((resolve, reject) => {
      db.get("SELECT * FROM cards WHERE id = ?", [id], (err, row) => err ? reject(err) : resolve(row));
    });
    if (!card) return res.status(404).json({ error: 'الكارت غير موجود' });

    const picks = await new Promise((resolve, reject) => {
      db.all(
        "SELECT das_code, courier_name, choice, updated_at FROM card_picks WHERE card_id = ?",
        [id],
        (err, rows) => err ? reject(err) : resolve(rows || [])
      );
    });

    const labels = cardChoices(card);
    const valid = picks.filter((p) => {
      const ch = Number(p.choice);
      return Number.isInteger(ch) && ch >= 0 && ch < labels.length;
    });

    const total = valid.length;

    // بيانات الروستر: كود المندوب = employee_code، زي باقي النظام
    // مش بننده الروستر لو مفيش أصوات — مفيش داعي نستنى الشبكة على كارت فاضي
    const roster = { configured: rosterConfigured(), ok: false, error: '' };
    const empByCode = new Map();
    if (roster.configured && total) {
      try {
        const emps = await promiseWithTimeout(rosterEmployees(), 8000);
        (emps || []).forEach((e) => {
          const code = String((e && e.employee_code) || '').trim().toUpperCase();
          if (code) empByCode.set(code, e);
        });
        roster.ok = true;
      } catch (e) {
        roster.error = e && e.message === 'timeout' ? 'الروستر اتأخر في الرد' : 'تعذر الاتصال بالروستر';
      }
    }
    const options = labels.map((label, index) => {
      const mine = valid.filter((p) => Number(p.choice) === index);
      const voters = mine.map((p) => {
        const code = String(p.das_code || '').trim().toUpperCase();
        const emp = empByCode.get(code) || null;
        let type = emp ? String(emp.employment_type || '').trim().toUpperCase() : '';
        if (type === 'FULL' || type === 'FULL_TIME' || type === 'FULLTIME') type = 'FT';
        if (type === 'PART' || type === 'PART_TIME' || type === 'PARTTIME') type = 'PT';
        return {
          das_code: code,
          name: String(p.courier_name || '').trim() || String((emp && emp.name) || code).trim(),
          branch: emp ? String(emp.branch || '').trim() : '',
          employment_type: type,
          shift: emp ? String(emp.shift || '').trim() : '',
          in_roster: !!emp,
          at: p.updated_at || ''
        };
      }).sort((a, b) => a.name.localeCompare(b.name, 'ar'));

      return {
        index,
        label,
        count: voters.length,
        percent: total ? Math.round(voters.length * 100 / total) : 0,
        full: voters.filter(v => v.employment_type === 'FT').length,
        part: voters.filter(v => v.employment_type === 'PT').length,
        voters
      };
    });

    res.json({
      card: { id: card.id, title: card.title, active: !!card.active, choices: labels, created_at: card.created_at },
      total,
      roster,
      options,
      generated_at: new Date().toISOString()
    });
  } catch (e) {
    res.status(500).json({ error: 'فشل جلب تفاصيل الكارت' });
  }
});

// 19-ب-2. حفظ ترتيب الكروت بعد السحب والإفلات — بنستلم كل الـ IDs بالترتيب الجديد
app.post('/api/admin/cards/reorder', (req, res) => {
  const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (!ids.length) return res.status(400).json({ error: 'قائمة الترتيب فاضية' });
  done(0);
  function done(i) {
    if (i >= ids.length) {
      db.all(`SELECT id FROM cards ${CARDS_ORDER}`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: 'فشل حفظ الترتيب' });
        res.json({ success: true, order: rows.map(r => r.id) });
        BUS.publish('cards', { reason: 'reorder' });
      });
      return;
    }
    db.run("UPDATE cards SET sort_order = ? WHERE id = ?", [i, ids[i]], (err) => {
      if (err) return res.status(500).json({ error: 'فشل حفظ الترتيب' });
      done(i + 1);
    });
  }
});

// 19-ج. إنشاء كارت جديد — بيروح آخر القايمة (والأدمن يقدر يسحبه ومكان عادي)
app.post('/api/admin/cards', (req, res) => {
  const p = cardPayload(req.body || {});
  if (p.error) return res.status(400).json({ error: p.error });
  const active = (req.body && req.body.active === false) ? 0 : 1;
  db.get("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM cards", [], (err, row) => {
    const sortOrder = (err || !row) ? 0 : row.next;
    db.run(
      `INSERT INTO cards (title, body, button_text, button_url, audience, audience_value, start_date, end_date, active, sort_order, choices)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.title, p.body, p.btnText, p.btnUrl, p.audience, p.audienceValue, p.startDate, p.endDate, active, sortOrder, p.choicesText],
      function (err2) {
        if (err2) return res.status(500).json({ error: 'فشل حفظ الكارت' });
        res.json({ success: true, card_id: this.lastID });
        BUS.publish('cards', { reason: 'create' });
        if (active) {
          notifyCardTargets({
            id: this.lastID, title: p.title, body: p.body,
            audience: p.audience, audience_value: p.audienceValue,
            start_date: p.startDate, end_date: p.endDate
          }).catch(() => {});
        }
      }
    );
  });
});

// 19-د. تعديل كارت — أو إيقاف/تشغيل لو الحقل الوحيد اللي راجع هو active
app.put('/api/admin/cards/:id', (req, res) => {
  const id = req.params.id;
  const b = req.body || {};
  db.get("SELECT * FROM cards WHERE id = ?", [id], (err, before) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!before) return res.status(404).json({ error: 'الكارت غير موجود' });

    if (Object.keys(b).length === 1 && 'active' in b) {
      db.run("UPDATE cards SET active = ? WHERE id = ?", [b.active ? 1 : 0, id], (err2) => {
        if (err2) return res.status(500).json({ error: 'فشل تحديث الكارت' });
        res.json({ success: true });
        BUS.publish('cards', { id: Number(id), reason: b.active ? 'activate' : 'deactivate' });
        // تشغيل كارت كان متوقف = تنبيه للمستهدفين (الإيقاف مش بيبعت حاجة)
        if (b.active) notifyCardTargets(before).catch(() => {});
      });
      return;
    }

    const p = cardPayload(b);
    if (p.error) return res.status(400).json({ error: p.error });
    const active = ('active' in b) ? (b.active ? 1 : 0) : before.active;
    db.run(
      `UPDATE cards SET title=?, body=?, button_text=?, button_url=?, audience=?, audience_value=?, start_date=?, end_date=?, active=?, choices=? WHERE id=?`,
      [p.title, p.body, p.btnText, p.btnUrl, p.audience, p.audienceValue, p.startDate, p.endDate, active, p.choicesText, id],
      (err2) => {
        if (err2) return res.status(500).json({ error: 'فشل تحديث الكارت' });
        // لو الخيارات قلّ أو اتشالت: نمسح الأصوات المتيمة (على اختيارات مش موجودة تاني)
        const nOpts = p.choicesText ? JSON.parse(p.choicesText).length : 0;
        db.run("DELETE FROM card_picks WHERE card_id = ? AND choice >= ?", [id, nOpts], () => {});
        res.json({ success: true });
        BUS.publish('cards', { id: Number(id), reason: 'edit' });
        // تعديل المحتوى أو الجمهور أو الفترة = تنبيه جديد (تعديلات الشكل/الترتيب مش بتنبه)
        const noticeChanged = active &&
          (p.title !== before.title || p.body !== before.body ||
           p.audience !== before.audience || p.audienceValue !== String(before.audience_value || '') ||
           p.startDate !== String(before.start_date || '') || p.endDate !== String(before.end_date || ''));
        if (noticeChanged) {
          notifyCardTargets({
            id: Number(id), title: p.title, body: p.body,
            audience: p.audience, audience_value: p.audienceValue,
            start_date: p.startDate, end_date: p.endDate
          }).catch(() => {});
        }
      }
    );
  });
});

// 19-هـ. مسح كارت (وبيمسح أصواته كمان)
app.delete('/api/admin/cards/:id', (req, res) => {
  db.run("DELETE FROM cards WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: 'فشل حذف الكارت' });
    if (this.changes === 0) return res.status(404).json({ error: 'الكارت غير موجود' });
    db.run("DELETE FROM card_picks WHERE card_id = ?", [req.params.id]);
    res.json({ success: true });
    BUS.publish('cards', { id: Number(req.params.id), reason: 'delete' });
  });
});

// 19-و. صوت المندوب على اختيار في كارت — صوت واحد لكل مندوب، وبيقدر يغيره في أي وقت
app.post('/api/courier/cards/pick', (req, res) => {
  if (rateLimited(req, 'card-pick', 30, 60e3)) return res.status(429).json({ error: 'محاولات كتير — استنى دقيقة' });
  const { das_code, card_id, choice } = req.body || {};
  const code = String(das_code || '').trim().toUpperCase();
  const name = String((req.body && req.body.name) || '').trim().slice(0, 80);
  const ch = Number(choice);
  if (!code || !Number.isInteger(card_id) || !Number.isInteger(ch)) {
    return res.status(400).json({ error: 'بيانات الصوت ناقصة' });
  }
  db.get("SELECT choices FROM cards WHERE id = ? AND active = 1", [card_id], (err, card) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!card) return res.status(404).json({ error: 'الكارت غير موجود أو متوقف' });
    let labels = [];
    try { const p = JSON.parse(card.choices || '[]'); if (Array.isArray(p)) labels = p; } catch (e) {}
    if (ch < 0 || ch >= labels.length) return res.status(400).json({ error: 'اختيار غير موجود' });
    db.run(
      `INSERT INTO card_picks (card_id, das_code, courier_name, choice) VALUES (?, ?, ?, ?)
       ON CONFLICT(card_id, das_code) DO UPDATE SET choice = excluded.choice, courier_name = excluded.courier_name, updated_at = CURRENT_TIMESTAMP`,
      [card_id, code, name, ch],
      (wErr) => {
        if (wErr) return res.status(500).json({ error: 'فشل تسجيل اختيارك' });
        res.json({ success: true, choice: ch });
      }
    );
  });
});

// 17. المفتاح العام للإشعارات — المتصفح محتاجه عشان يعمل اشتراك
app.get('/api/push/key', (req, res) => {
  if (!pushEnabled) return res.json({ enabled: false });
  res.json({ enabled: true, public_key: PUSH_PUBLIC_KEY });
});

// 18. تسجيل جهاز المندوب للإشعارات — نفس endpoint بيتحدث لو الجهاز جدد الاشتراك
app.post('/api/push/subscribe', (req, res) => {
  if (rateLimited(req, 'push-sub', 10, 60e3)) return res.status(429).json({ error: 'محاولات كتير — استنى دقيقة وجرب تاني' });
  if (!pushEnabled) return res.status(503).json({ error: 'الإشعارات مش متفعلة على السيرفر' });
  const { das_code, endpoint, keys } = req.body || {};
  if (!das_code || !endpoint || !keys || !keys.p256dh || !keys.auth) {
    return res.status(400).json({ error: 'بيانات الاشتراك ناقصة' });
  }

  const cleanCode = String(das_code).trim().toUpperCase();
  db.run(
    `INSERT INTO push_subs (das_code, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET das_code = excluded.das_code, p256dh = excluded.p256dh, auth = excluded.auth`,
    [cleanCode, String(endpoint), String(keys.p256dh), String(keys.auth)],
    (err) => {
      if (err) return res.status(500).json({ error: 'فشل تسجيل الاشتراك' });
      res.json({ success: true });
    }
  );
});

// 19. إلغاء اشتراك جهاز (لو المندوب قفل الإشعارات من الزرار)
app.post('/api/push/unsubscribe', (req, res) => {
  const { endpoint } = req.body || {};
  if (!endpoint) return res.status(400).json({ error: 'endpoint مطلوب' });
  db.run("DELETE FROM push_subs WHERE endpoint = ?", [String(endpoint)], (err) => {
    if (err) return res.status(500).json({ error: 'فشل الإلغاء' });
    res.json({ success: true });
  });
});

// ================= جسر الروستر (الحضور لايف) =================
// الربط مع سيستم الروستر والحضور: الرابط وباسورد الأدمن من Variables على Railway
// (ROSTER_URL + ROSTER_ADMIN_PASSWORD). من غيرهم السيرفر بيشتغل عادي —
// بس قسم الحضور في بروفايل المندوب هياخد "الروستر مش مربوط".
// السيرفر هنا وسيط بس: التوكن بيفضل جواه ومفيش أي باسورد بيروح للمتصفح.
const ROSTER_URL = (process.env.ROSTER_URL || '').replace(/\/+$/, '');
const ROSTER_URL_FULL = ROSTER_URL ? (ROSTER_URL.startsWith('http') ? ROSTER_URL : 'https://' + ROSTER_URL) : '';
const ROSTER_ADMIN_PASSWORD = process.env.ROSTER_ADMIN_PASSWORD || '';
// مفتاح واجهات حضور/انصراف من DAS للروستر — سر سيرفري تاني مش تابع لأدمن الروستر،
// بنفس القيمة بتتحدد كـ DAS_SECRET على سيرفر الروستر. عمرو ما بيروح للمتصفح.
const ROSTER_DAS_SECRET = process.env.ROSTER_DAS_SECRET || '';
const rosterState = { connected: false, rev: 0, employees: 0 };

let rosterToken = '';
let rosterLoginAt = 0;
let rosterEmployeesCache = null;
let rosterEmployeesAt = 0;

function rosterConfigured() {
  return !!ROSTER_URL_FULL && !!ROSTER_ADMIN_PASSWORD;
}

// واجهات حضور/انصراف DAS شغالة بس لو الروستر مربوط + المفتاح السري محطوط
function dasEnabled() {
  return rosterConfigured() && !!ROSTER_DAS_SECRET;
}

async function rosterLogin(retried = false) {
  rosterLoginAt = Date.now();
  const res = await fetch(ROSTER_URL_FULL + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ROSTER_ADMIN_PASSWORD })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    if (res.status === 429 && !retried) {
      // قفل IP مؤقت من الروستر — نستنى ونجرّب مرة واحدة
      await new Promise((r) => setTimeout(r, 65e3));
      return rosterLogin(true);
    }
    throw new Error('فشل تسجيل الدخول للروستر (' + res.status + ')');
  }
  rosterToken = data.token;
}

async function rosterFetch(path, opts = {}) {
  const res = await fetch(ROSTER_URL_FULL + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + rosterToken, ...(opts.headers || {}) }
  });
  if (res.status === 401) {
    await rosterLogin();
    return rosterFetch(path, opts);
  }
  return res;
}

// حلقة لايف: long-poll على أحداث الروستر — أي تسجيل حضور في أي تاب بيجي هنا فورًا
// وبيزوّد rev، وواجهة الأدمن بتقارن rev كل 4 ثواني فبتحدّث قسم الحضور نفسها.
async function rosterLiveLoop() {
  if (!rosterConfigured()) {
    console.warn('[DAS] ROSTER_URL/ROSTER_ADMIN_PASSWORD not set — roster bridge disabled');
    return;
  }
  console.log('[DAS] Roster bridge starting — target:', ROSTER_URL_FULL);
  let since = 0;
  for (;;) {
    try {
      const res = await fetch(ROSTER_URL_FULL + `/api/events?since=${since}&wait=28`, { headers: { Authorization: 'Bearer ' + rosterToken } });
      if (res.status === 401) { await rosterLogin(); continue; }
      const data = await res.json().catch(() => null);
      if (!data) throw new Error('bad payload');
      since = data.rev || since;
      rosterState.connected = true;
      rosterState.rev = data.rev;
      rosterState.employees = rosterEmployeesCache ? rosterEmployeesCache.length : 0;
      await new Promise((r) => setTimeout(r, 400)); // نبضة خفيفة قبل الجولة اللي جاية
    } catch (e) {
      rosterState.connected = false;
      console.error('[DAS] Roster long-poll error:', e.message);
      await new Promise((r) => setTimeout(r, 5000));
      // إعادة تسجيل الدخول مرة كل دقيقة بالكتير — الروستر بيقفل الـIP لو المحاولات كترت
      if (Date.now() - rosterLoginAt > 60e3) {
        try { await rosterLogin(); } catch (e2) {}
      }
    }
  }
}

// كاش الموظفين من الروستر — بنمشي عليه لربط كود المندوب بمعرّف موظف الروستر
async function rosterEmployees() {
  if (rosterEmployeesCache && Date.now() - rosterEmployeesAt < 60e3) return rosterEmployeesCache;
  const res = await rosterFetch('/api/employees?active_only=false');
  if (!res.ok) throw new Error('فشل جلب موظفي الروستر (' + res.status + ')');
  const data = await res.json().catch(() => ([]));
  rosterEmployeesCache = Array.isArray(data) ? data : [];
  rosterEmployeesAt = Date.now();
  rosterState.employees = rosterEmployeesCache.length;
  return rosterEmployeesCache;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// نبضة حالة الجسر — الواجهة بتسأل كل 4 ثواني وبتقارن rev عشان تعرف تحدّط قسم الحضور
app.get('/api/admin/roster-status', (req, res) => {
  res.json({ roster: rosterState, configured: rosterConfigured(), das_integration: dasEnabled() });
});

// 20. الحضور بتاع مندوب من الروستر — المندوب بيتطابق بالكود (das_code = كود الموظف)
// ولو الكود فاضي بيتطابق بالاسم. الأسبوع بيتحدد بـ start/end من الواجهة.
app.get('/api/admin/roster-attendance/:dasCode', async (req, res) => {
  if (!rosterConfigured()) return res.status(503).json({ error: 'الروستر مش مربوط — ظبّط ROSTER_URL و ROSTER_ADMIN_PASSWORD من Variables' });
  const code = String(req.params.dasCode || '').trim().toUpperCase();
  const name = String(req.query.name || '').trim();
  try {
    const emps = await rosterEmployees();
    let emp = emps.find((x) => String(x.employee_code || '').trim().toUpperCase() === code);
    let matchedBy = 'code';
    if (!emp && name) {
      emp = emps.find((x) => String(x.name || '').trim() === name) || emps.find((x) => String(x.name || '').trim() === name && x.active);
      matchedBy = 'name';
    }
    if (!emp) return res.json({ found: false, roster: rosterState });

    const start = ISO_DATE.test(String(req.query.start || '')) ? String(req.query.start) : '';
    const end = ISO_DATE.test(String(req.query.end || '')) ? String(req.query.end) : '';
    let path = '/api/reports/employee/' + emp.id;
    if (start && end) path += `?start=${start}&end=${end}`;

    const r = await rosterFetch(path);
    if (!r.ok) return res.status(502).json({ error: 'الروستر رد بخطأ (' + r.status + ') — جرب تاني' });
    const data = await r.json();
    // الفرع ونوع التوظيف (FT/PT) — من بيانات الموظف في تقرير الروستر، وباكر داتا الكاش للنيوبة
    res.json({ found: true, matched_by: matchedBy, roster: rosterState,
      branch: (data.employee && data.employee.branch) || emp.branch || '',
      employment_type: (data.employee && data.employee.employment_type) || emp.employment_type || '',
      employee: data.employee, stats: data.stats, records: data.records, weeks: data.weeks || [] });
  } catch (e) {
    rosterState.connected = false;
    res.status(502).json({ error: 'مفيش اتصال بالروستر دلوقتي — جرب تاني بعد ثواني' });
  }
});

// ================= مزامنة مناديب DAS مع موظفي الروستر =================
// DAS هو مصدر الحقيقة: الاسم والكود بتوع DAS هي اللي بتتكتب في الروستر.
// المقارنة (فرق الأسماء) بتحصل في الواجهة — هنا جسر آمن بس:
// السيرفر بيجيب البيانات ويطبّق التحديثات المختارة، من غير ما يقرّر في المقارنة.

function localISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// كل موظفي الروستر — بندمج 4 أسابيع ورا بعض عشان مايفوتش حد متشال من جدول أسبوع معيّن
async function rosterEmployeesAll() {
  const map = new Map();
  const base = await rosterEmployees();
  (Array.isArray(base) ? base : []).forEach(e => map.set(Number(e.id), e));
  for (let k = 1; k <= 3; k++) {
    const d = new Date();
    d.setDate(d.getDate() + k * 7);
    try {
      const res = await rosterFetch('/api/employees?active_only=false&week=' + localISO(d));
      if (!res.ok) continue;
      const list = await res.json().catch(() => []);
      (Array.isArray(list) ? list : []).forEach(e => {
        if (!map.has(Number(e.id))) map.set(Number(e.id), e);
      });
    } catch (e) { /* أسبوع مش متاح — نكمل بالباقي */ }
  }
  return Array.from(map.values());
}

// 21. بيانات المقارنة: مناديب DAS + موظفو الروستر
app.get('/api/admin/roster-sync', async (req, res) => {
  if (!rosterConfigured()) return res.status(503).json({ error: 'الروستر مش مربوط — ظبّط ROSTER_URL و ROSTER_ADMIN_PASSWORD من Variables' });
  try {
    const couriers = await new Promise((resolve, reject) => {
      db.all("SELECT das_code, name, phone FROM couriers ORDER BY name COLLATE NOCASE ASC", [], (err, rows) => {
        if (err) return reject(err);
        resolve(rows || []);
      });
    });
    const employees = await rosterEmployeesAll();
    res.json({ couriers, employees, roster: rosterState });
  } catch (e) {
    rosterState.connected = false;
    res.status(502).json({ error: 'مفيش اتصال بالروستر دلوقتي — جرب تاني بعد ثواني' });
  }
});

// 22. تطبيق التحديثات المختارة على موظفي الروستر (الاسم والكود من DAS)
// التحديث المختار: { id, name, employee_code }
app.post('/api/admin/roster-sync/apply', async (req, res) => {
  if (!rosterConfigured()) return res.status(503).json({ error: 'الروستر مش مربوط — ظبّط ROSTER_URL و ROSTER_ADMIN_PASSWORD من Variables' });
  const updates = Array.isArray(req.body && req.body.updates) ? req.body.updates : [];
  if (!updates.length) return res.status(400).json({ error: 'مفيش تحديثات مختارة' });
  if (updates.length > 500) return res.status(400).json({ error: 'عدد التحديثات كبير أوي' });

  let emps = [];
  try { emps = await rosterEmployeesAll(); } catch (e) {
    rosterState.connected = false;
    return res.status(502).json({ error: 'مفيش اتصال بالروستر دلوقتي — جرب تاني بعد ثواني' });
  }
  const byId = new Map(emps.map(e => [Number(e.id), e]));
  const results = [];

  for (const u of updates) {
    const id = Number(u && u.id);
    const emp = byId.get(id);
    const name = String((u && u.name) || '').trim();
    const code = String((u && u.employee_code) || '').trim();
    if (!emp) { results.push({ id, ok: false, error: 'الموظف غير موجود في الروستر' }); continue; }
    if (!name) { results.push({ id, ok: false, error: 'الاسم فاضي' }); continue; }

    // بنبعت كل بيانات الموظف تانية (الروستر بيستبدل السجل بالكامل)
    // وبناخد الفرع والشيفت من نفس الموظف عشان ما يتغيرش حاجة غير الاسم والكود
    const payload = {
      name,
      employee_code: code || null,
      branch: emp.branch,
      shift: String(emp.shift || '').trim() || 'Morning',
      employment_type: emp.employment_type || 'FT',
      day_off: emp.day_off || 'Friday',
      active: !!emp.active,
      phone: emp.phone || null
    };
    try {
      const r = await rosterFetch('/api/employees/' + id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        let msg = d.detail || d.error || ('الروستر رد بخطأ (' + r.status + ')');
        if (typeof msg === 'object' && Array.isArray(msg)) msg = msg.map(x => x.msg || '').join(' • ') || String(r.status);
        results.push({ id, ok: false, error: String(msg) });
        continue;
      }
      const updated = await r.json().catch(() => ({}));
      results.push({ id, ok: true, name: updated.name || name, employee_code: updated.employee_code || code });
    } catch (e) {
      results.push({ id, ok: false, error: e.message || 'فشل الاتصال بالروستر' });
    }
  }

  // البيانات اتغيّرت — نمسح الكاش عشان التحميل الجاي يجد الحالة الجديدة
  rosterEmployeesCache = null;
  rosterEmployeesAt = 0;
  const okCount = results.filter(r => r.ok).length;
  res.json({ ok: okCount, failed: results.length - okCount, results });
});

// 23. بيانات طلبات الحضور للمندوب + حالته الحالية (إيه اللي ينفع يسجّل دلوقتي)
// كل الحسابات هنا من الداتابيز المحلية — المتصفح ما بيبعتش أي وقت أو كود يتنفذ.
app.get('/api/courier/attendance/:das_code', async (req, res) => {
  const code = String(req.params.das_code || '').trim().toUpperCase();
  db.all("SELECT * FROM att_requests WHERE das_code = ? ORDER BY id DESC LIMIT 15", [code], async (err, rows) => {
    if (err) return res.status(500).json({ error: 'خطأ في جلب طلبات الحضور' });
    rows = rows || [];
    // شيفت الموظف (من كاش الروستر) بيتعرض للمندوب كمعلومة بس — التسجيل فوري
    // من غير موافقة مشرف، والوقت والقواعد من الروستر.
    let emp = null;
    if (dasEnabled()) {
      try {
        const emps = await rosterEmployees();
        emp = emps.find(x => String(x.employee_code || '').trim().toUpperCase() === code) || null;
      } catch (e) { emp = null; }
    }
    const plan = emp ? shiftPlan(emp) : null;
    res.json({ enabled: dasEnabled(), requests: rows, state: attendanceState(rows, emp),
               shift: emp ? { text: plan ? plan.shift : String(emp.shift || ''), day_off: String(emp.day_off || '') } : null });
  });
});

// الحالة المحسوبة للسجل: إيه اللي ينفع يتسجّل دلوقتي بناءً على الطلبات المسجّلة.
// التسجيل فوري من غير موافقة: الحضور بيسمح بالانصراف، وبعد دورة كاملة مفيش
// حضور تاني في نفس يوم الشيفت. صفوف Pending القديمة بس هي اللي لسه بتمنع.
function attendanceState(rows, emp) {
  const plan = emp ? shiftPlan(emp) : null;
  const shiftInfo = plan ? { text: plan.shift, start: plan.start, end: plan.end, day_off: (emp && emp.day_off) || '' } : null;

  const pend = rows.find(r => r.status === 'Pending');
  if (pend) {
    return { next: null, blocked: true, shift: shiftInfo,
      why: pend.action === 'check_in' ? 'طلب حضور قديم لسه بيتزامن — جرّب تحديث الصفحة' : 'طلب انصراف قديم لسه بيتزامن — جرّب تحديث الصفحة' };
  }

  const lastIn = rows.find(r => r.action === 'check_in' && r.status === 'Approved');
  const outAfter = lastIn ? rows.find(r => r.action === 'check_out' && r.id > lastIn.id && r.status === 'Approved') : null;

  if (!lastIn) {
    // مفيش حضور: تسجيل الحضور متاح في أي وقت — الروستر هو اللي بيحدد التأخير والغرامة.
    return { next: 'check_in', blocked: false, why: '', shift: shiftInfo };
  }

  if (!outAfter) {
    // حضور مسجّل مالوش انصراف بعده: تسجيل الانصراف متاح في أي وقت.
    return { next: 'check_out', blocked: false, why: '', shift: shiftInfo };
  }

  // الدورة كاملة (حضور + انصراف): حضور تاني ممنوع في نفس يوم الشيفت.
  if (lastIn.attendance_date === cairoToday()) {
    return { next: null, blocked: true, shift: shiftInfo,
      why: 'حضورك وانصرافك اتسجلوا رسميًا — مش هينفع حضور تاني النهاردة' };
  }
  return { next: 'check_in', blocked: false, why: '', shift: shiftInfo };
}

// وقت القاهرة (UTC+3) — نفس منطق توقيت الروستر
function cairoToday() {
  return new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
}

// ================= عرض الشيفت (بلا بوابات وقت) =================
// تسجيل الحضور والانصراف على مدار 24 ساعة وكل طلب بيتقرر يدويًا من المشرف
// في لوحة الروستر (موافقة/رفض) — الشيفت بيتعرض هنا كمعلومة للمندوب بس.
const pad2 = (n) => String(n).padStart(2, '0');
function hm(min) { const m = ((min % 1440) + 1440) % 1440; return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60); }
// عرض الوقت بنظام 12 ساعة للمندوب (5:10 ص / 4:25 م)
function hm12(min) {
  const m = ((min % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const hh = h24 % 12 || 12;
  return hh + ':' + pad2(m % 60) + ' ' + (h24 < 12 ? 'ص' : 'م');
}

// قراءة وقت بداية/نهاية الشيفت من اسمه ("08:00-17:00" / "8 AM - 4 PM" / "22:00-09:00")
function parseShiftTimes(name) {
  const text = String(name || '').replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?m\.?|p\.?m\.?|ص|م)?/gi;
  const times = [];
  let m;
  while ((m = re.exec(text)) && times.length < 2) {
    let h = parseInt(m[1], 10);
    const mi = parseInt(m[2] || '0', 10);
    if (!Number.isFinite(h) || mi > 59) continue;
    const ap = String(m[3] || '').toLowerCase().replace(/\./g, '');
    if (ap === 'am' || ap === 'ص') { if (h < 1 || h > 12) continue; h = h === 12 ? 0 : h; }
    else if (ap === 'pm' || ap === 'م') { if (h < 1 || h > 12) continue; h = h === 12 ? 12 : h + 12; }
    else { if (h > 24) continue; h %= 24; }
    times.push(h * 60 + mi);
  }
  if (times.length < 2) return null;
  const start = times[0];
  let end = times[1];
  if (end <= start) end += 1440;      // شيفت ليلي بعدي منتصف الليل
  return { start, end, text: hm(start) + ' - ' + hm(end) };
}

function shiftPlan(emp) {
  const parsed = parseShiftTimes(emp && emp.shift);
  if (!parsed) return null;
  return {
    shift: hm12(parsed.start) + ' - ' + hm12(parsed.end), start: hm12(parsed.start), end: hm12(parsed.end),
    startMin: parsed.start, endMin: parsed.end
  };
}

// نداء واجهات الربط في الروستر — بالمفتاح السري بتاع الربط (X-DAS-Secret)
async function rosterDasFetch(path, opts = {}) {
  const res = await fetch(ROSTER_URL_FULL + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'X-DAS-Secret': ROSTER_DAS_SECRET, ...(opts.headers || {}) }
  });
  return res;
}

// 24. تسجيل حضور أو انصراف من المندوب — الروستر بيسجّله فورًا (من غير موافقة).
// والكود بيتسحب من الداتابيز (مش من الجسم)، والوقت هنا هو وقت استلام السيرفر.
// وقت الجهاز اللي بيبعته متصفح المندوب للعرض فقط — مش بيتسجّل كتوقيت رسمي لي أي حاجة.
app.post('/api/courier/attendance/request', async (req, res) => {
  if (rateLimited(req, 'att-request', 25, 60e3)) return res.status(429).json({ error: 'محاولات كتير — استنى دقيقة وجرب تاني' });
  const { das_code, action } = req.body || {};
  if (!['check_in', 'check_out'].includes(action)) return res.status(400).json({ error: 'نوع الطلب غير معروف' });
  if (!dasEnabled()) return res.status(503).json({ error: 'الربط مش متاح — كلم الإدارة' });

  const cleanCode = String(das_code || '').trim().toUpperCase();
  db.get("SELECT * FROM couriers WHERE UPPER(das_code) = ?", [cleanCode], async (err, courier) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!courier) return res.status(404).json({ error: 'كود المندوب غير مسجل في السيستم' });

    const receivedAt = new Date().toISOString();
    const deviceTime = String((req.body && req.body.device_time) || '').replace(/[^0-9:]/g, '').slice(0, 5);

    // التطابق مع موظف الروصر بيكون بالكود حصرًا — الاسم عمرو ما بيستخدم للربط
    let emp = null;
    try {
      const emps = await rosterEmployees();
      emp = emps.find(x => String(x.employee_code || '').trim().toUpperCase() === cleanCode);
    } catch (e) {
      return res.status(502).json({ error: 'الروستر مش متاح دلوقتي — جرب بعد دقيقة' });
    }
    if (!emp) {
      return res.status(409).json({ error: 'كودك مش مربوط بموظف في الروستر — الربط بيتم من شاشة ربط الروستر في لوحة الإدارة' });
    }

    // فلتر سريع قبل النداء للروستر — الروستر هو المصدر الأول والأخير للقواعد
    db.all("SELECT * FROM att_requests WHERE das_code = ? ORDER BY id DESC LIMIT 15", [cleanCode], async (err2, rows) => {
      if (err2) return res.status(500).json({ error: 'خطأ في السيرفر' });
      rows = rows || [];
      const st = attendanceState(rows, emp);
      if (st.blocked) return res.status(409).json({ error: st.why });
      if (st.next && st.next !== action) {
        return res.status(409).json({ error: action === 'check_in'
          ? 'حضورك مسجّل بالفعل — سجّل الانصراف'
          : 'مفيش حضور مسجل لتسجيل انصراف بعده — سجّل حضور الأول' });
      }

      try {
        const r = await rosterDasFetch('/api/das/requests', {
          method: 'POST',
          body: JSON.stringify({ action, employee_code: cleanCode, courier_name: courier.name, courier_local_at: deviceTime })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
          const msg = typeof data.detail === 'string' ? data.detail : 'الروستر رفض الطلب (' + r.status + ')';
          return res.status(r.status === 404 ? 409 : r.status === 409 ? 409 : 502).json({ error: msg });
        }
        const day = data.attendance_date || cairoToday();
        const status = data.status || 'Approved';
        const note = data.message || (status === 'Approved'
          ? (action === 'check_in' ? 'تم تسجيل حضورك تلقائيًا' : 'تم تسجيل انصرافك تلقائيًا')
          : '');
        db.run(
          `INSERT INTO att_requests
             (das_code, courier_name, roster_req_id, attendance_date, action, status,
              requested_at, device_time, roster_decided_at, decision_note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [cleanCode, courier.name, data.id, day, action, status, receivedAt, deviceTime,
            status === 'Approved' ? (data.decided_at || receivedAt) : '', note],
          function (err3) {
            if (err3) {
              // تكرار متزامن (دبل-كليك): مطلوب موجود بالفعل
              if (err3 && err3.code === 'SQLITE_CONSTRAINT') return res.status(409).json({ error: 'نفس الطلب مسجّل بالفعل' });
              return res.status(500).json({ error: 'فشل تسجيل طلب الحضور' });
            }
            res.json({
              success: true,
              message: note,
              request: {
                id: this.lastID, action, status, attendance_date: day,
                requested_at: receivedAt,
                worked_minutes: data.worked_minutes || 0,
                early: !!data.early,
                early_minutes: data.early_minutes || 0
              },
              state: { next: status === 'Approved' ? (action === 'check_in' ? 'check_out' : null) : null, blocked: false }
            });
            BUS.publish('attendance', { das_code: cleanCode, id: this.lastID, reason: 'new' });
          }
        );
      } catch (e) {
        res.status(502).json({ error: 'الربط مش متاح دلوقتي — جرب بعد دقيقة' });
      }
    });
  });
});

// ================= مزامنة حالات طلبات الحضور من الروستر =================
// دورة كل نص دقيقة: بتجيب الطلبات اللي قرر عليها مشرف من الروستر (وقت آخر مزامنة
// وأي طلب لسه Pending) وتحدّط النسخ المحلية + بتبعت إشعار للمندوب بالتغيير.
let dassSyncAt = '';
async function dassSyncStatuses() {
  if (!dasEnabled()) return;
  const since = String(dassSyncAt || '2000-01-01T00:00:00');
  let data;
  try {
    const r = await rosterDasFetch('/api/das/requests?updated_since=' + encodeURIComponent(since) + '&limit=200');
    if (!r.ok) return;
    data = await r.json().catch(() => null);
  } catch (e) { return; }
  if (!data || !Array.isArray(data.requests)) return;
  dassSyncAt = new Date().toISOString().slice(0, 19);

  // بالتسلسل عشان الداتابيز مش هتدبل-lock مع تزايد الطلبات
  for (const req of data.requests) {
    await new Promise((resolve) => {
      db.get("SELECT * FROM att_requests WHERE roster_req_id = ?", [req.id], (err, local) => {
        if (err || local) {
          if (err || !local) return resolve();
          if (local.status === req.status) return resolve();
          db.run(
            "UPDATE att_requests SET status = ?, roster_decided_at = ?, decision_note = ? WHERE id = ?",
            [req.status, req.decided_at || '', req.decision_note || '', local.id],
            () => {
              BUS.publish('attendance', { das_code: local.das_code, id: local.id, status: req.status });
              if (req.status === 'Approved') notifyCourier(local.das_code, req.action === 'check_in' ? 'حضورك اتسجّل في الروستر' : 'انصرافك اتسجّل في الروستر', 'المشرف وافق على طلبك', { kind: 'attendance', ref: 'att:' + local.id });
              else if (req.status === 'Rejected') notifyCourier(local.das_code, 'طلب حضورك اترفض', (req.decision_note || '').slice(0, 120) || 'راجع المشرف', { kind: 'attendance', ref: 'att:' + local.id });
              resolve();
            });
          return;
        }
        // fallback: طلب اتعمل في الروستر وردّه ما وصلناش وقتها (شبكة قطعت) — بنطابقه
        // بالكود والنوع ويوم الشيفت وهو لسه Pending، وبنربطه بمعرّف الروستر ونحدّث الحالة
        db.get(
          "SELECT id, das_code FROM att_requests WHERE roster_req_id IS NULL AND das_code = ? AND action = ? AND attendance_date = ? AND status = 'Pending'",
          [req.employee_code || '', req.action || '', req.attendance_date || ''],
          (err2, cand) => {
            if (err2 || !cand) return resolve();
            db.run(
              "UPDATE att_requests SET roster_req_id = ?, status = ?, roster_decided_at = ?, decision_note = ? WHERE id = ?",
              [req.id, req.status, req.decided_at || '', req.decision_note || '', cand.id],
              () => {
                BUS.publish('attendance', { das_code: cand.das_code, id: cand.id, status: req.status });
                resolve();
              });
          });
      });
    });
  }
}
setInterval(dassSyncStatuses, 12000).unref();
dassSyncStatuses().catch(() => {});

rosterLiveLoop().catch(() => {});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
