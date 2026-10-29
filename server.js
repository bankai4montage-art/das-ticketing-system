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
const pushEnabled = Boolean(PUSH_PUBLIC_KEY && PUSH_PRIVATE_KEY);
if (pushEnabled) {
  webpush.setVapidDetails('mailto:admin@das-portal', PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY);
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

const STATUSES = ['يتم المراجعة', 'اتحلت', 'لازم تيجي المكتب', 'مرفوض بسبب الروستر'];
const ADV_STATUSES = ['قيد المراجعة', 'تمت الصرف', 'مرفوضة'];

// الأرشفة التلقائية: الشكوى اللي اتحلت ومعدّش على حلها 30 يوم بتتأرشف (بتخرج من الجدول الرئيسي)
let lastSweep = 0;
function sweepArchive() {
  const now = Date.now();
  if (now - lastSweep < 60e3) return;
  lastSweep = now;
  db.run(
    "UPDATE tickets SET archived = 1 WHERE archived = 0 AND status = 'اتحلت' AND updated_at <= datetime('now', '-30 days')"
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

  // قاعدة قديمة؟ نزود الأعمدة الناقصة تلقائي (بعد إنشاء الجدول)
  // الكروت: sort_order للترتيب بالسحب والإفلات — الموجودين قبل التحديث بنرتّبهم
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

// ================= API للمندوب =================

// 1. تسجيل دخول المندوب بالكود (DAS Login)
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
app.get('/api/courier/tickets/:das_code', (req, res) => {
  const cleanCode = String(req.params.das_code || '').trim().toUpperCase();
  db.run(
    `UPDATE tickets SET seen_note = admin_note, seen_at = CURRENT_TIMESTAMP
     WHERE UPPER(das_code) = ? AND admin_note != '' AND (seen_note IS NULL OR seen_note != admin_note)`,
    [cleanCode],
    () => {
      db.all(
        "SELECT * FROM tickets WHERE UPPER(das_code) = ? ORDER BY id DESC",
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
      }
    );
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

// 7. جلب كل الشكاوى للإدارة (بدون المؤرشفة)
app.get('/api/admin/tickets', (req, res) => {
  sweepArchive();
  db.all("SELECT * FROM tickets WHERE archived = 0 ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'خطأ في جلب الشكاوى' });
    res.json({ tickets: rows });
  });
});

// 7-ب. جلب الأرشيف (الشكاوى اللي اتحلت ومعدّي عليها 30 يوم)
app.get('/api/admin/tickets/archived', (req, res) => {
  sweepArchive();
  db.all("SELECT * FROM tickets WHERE archived = 1 ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'خطأ في جلب الأرشيف' });
    res.json({ tickets: rows });
  });
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

        const noteChanged = String(admin_note || '') !== String(before.admin_note || '');
        const statusChanged = status !== before.status;
        if (!noteChanged && !statusChanged) return;
        const note = String(admin_note || '').slice(0, 140);
        let title = 'تحديث على شكواك';
        if (statusChanged) {
          if (status === 'اتحلت') title = 'مبروك — شكواك اتحلت';
          else if (status === 'لازم تيجي المكتب') title = 'لازم تيجي المكتب بخصوص شكواك';
          else if (status === 'مرفوض بسبب الروستر') title = 'شكواك مرفوضة بسبب بيانات الروستر';
        } else if (noteChanged && note) {
          title = 'الإدارة ردت على شكواك';
        }
        sendPush(before.das_code, title, note);
      }
    );
  });
});

// 9. مسح شكوى معينة من الإدارة
app.delete('/api/admin/tickets/:id', (req, res) => {
  const ticketId = req.params.id;
  db.run("DELETE FROM tickets WHERE id = ?", [ticketId], function (err) {
    if (err) return res.status(500).json({ error: 'فشل حذف الشكوى' });
    res.json({ success: true });
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
        sendPush(cleanCode, 'اتسجلت سلفة ليك', 'مبلغ ' + amt + ' ج — ' + String(reason).slice(0, 120));
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

        if (status === before.status) return;
        let title = 'تحديث على سلفتك';
        if (status === 'تمت الصرف') title = 'تم صرف سلفتك — ' + before.amount + ' ج';
        else if (status === 'مرفوضة') title = 'سلفتك مرفوضة';
        else if (status === 'قيد المراجعة') title = 'سلفتك قيد المراجعة';
        sendPush(before.das_code, title, String(admin_note || '').slice(0, 140));
      }
    );
  });
});

// 16. مسح سلفة (لو اتسجلت بالغلط)
app.delete('/api/admin/advances/:id', (req, res) => {
  db.run("DELETE FROM advances WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: 'فشل مسح السلفة' });
    res.json({ success: true });
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

// تجميع أصوات كارت على اختياراته — عشان الأدمن يشوف مين اختار إيه
// الأصوات اليتيمة (اختيار اتشال من الكارت) مبتتحسبش — وبتتنضف من القاعدة عند الحفظ
function tallyPicks(card, picks) {
  const choices = [];
  try { const p = JSON.parse(card.choices || '[]'); if (Array.isArray(p)) choices.push(...p); } catch (e) {}
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
const rosterState = { connected: false, rev: 0, employees: 0 };

let rosterToken = '';
let rosterLoginAt = 0;
let rosterEmployeesCache = null;
let rosterEmployeesAt = 0;

function rosterConfigured() {
  return !!ROSTER_URL_FULL && !!ROSTER_ADMIN_PASSWORD;
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
  res.json({ roster: rosterState, configured: rosterConfigured() });
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

rosterLiveLoop().catch(() => {});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
