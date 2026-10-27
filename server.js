const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const { parse } = require('csv-parse');

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

// توكن إدمن عشوائي لكل تشغيل — بيتسلم بعد نجاح اللوجين وبيتفحص على كل مسار أدمن
const ADMIN_TOKEN = crypto.randomBytes(24).toString('hex');

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

const STATUSES = ['يتم المراجعة', 'اتحلت', 'لازم تيجي المكتب'];
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
      archived INTEGER DEFAULT 0
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

  // قاعدة قديمة من غير عمود الأرشفة؟ نزوده تلقائي مرة واحدة (بعد إنشاء الجدول)
  db.all("PRAGMA table_info(tickets)", (err, cols) => {
    if (err || !cols) return;
    if (!cols.some(c => c.name === 'archived')) {
      db.run("ALTER TABLE tickets ADD COLUMN archived INTEGER DEFAULT 0");
    }
  });
});

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

// 2. جلب شكاوى المندوب الخاصة به
app.get('/api/courier/tickets/:das_code', (req, res) => {
  const cleanCode = String(req.params.das_code || '').trim().toUpperCase();
  db.all(
    "SELECT * FROM tickets WHERE UPPER(das_code) = ? ORDER BY id DESC",
    [cleanCode],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'خطأ في جلب البيانات' });
      res.json({ tickets: rows });
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

  db.run(
    `UPDATE tickets SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP,
       archived = CASE WHEN ? = 'اتحلت' THEN archived ELSE 0 END
     WHERE id = ?`,
    [status, String(admin_note || ''), status, ticketId],
    function (err) {
      if (err) return res.status(500).json({ error: 'فشل تحديث الحالة' });
      res.json({ success: true });
    }
  );
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

  db.run(
    `UPDATE advances SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, String(admin_note || ''), req.params.id],
    function (err) {
      if (err) return res.status(500).json({ error: 'فشل تحديث السلفة' });
      res.json({ success: true });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
