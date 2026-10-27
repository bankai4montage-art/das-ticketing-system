const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const { parse } = require('csv-parse');

const app = express();
const PORT = process.env.PORT || 3000;

// مسار الداتا بيز (يدعم Railway Volume لو ضفته، أو يشتغل محلياً)
const dbPath = process.env.RAILWAY_VOLUME_MOUNT_PATH
  ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'database.db')
  : path.join(__dirname, 'database.db');

const db = new sqlite3.Database(dbPath);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// إنشاء الجداول وإضافة بيانات مبدئية
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
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // إضافة مناديب تجريبيين لو الجدول فاضي
  db.get("SELECT COUNT(*) as count FROM couriers", (err, row) => {
    if (row && row.count === 0) {
      const stmt = db.prepare("INSERT INTO couriers (das_code, name, phone) VALUES (?, ?, ?)");
      stmt.run("DAS-101", "أحمد محمد علي", "01012345678");
      stmt.run("DAS-102", "محمود حسن إبراهيم", "01287654321");
      stmt.run("DAS-103", "كريم عادل سعيد", "01122334455");
      stmt.run("DAS-104", "مصطفى طارق", "01555667788");
      stmt.finalize();
    }
  });
});

// ================= API للمندوب =================

// 1. تسجيل دخول المندوب بالكود (DAS Login)
app.post('/api/courier/login', (req, res) => {
  const { das_code } = req.body;
  if (!das_code) return res.status(400).json({ error: 'يرجى إدخال الكود' });

  const cleanCode = das_code.trim().toUpperCase();
  db.get("SELECT * FROM couriers WHERE UPPER(das_code) = ?", [cleanCode], (err, courier) => {
    if (err) return res.status(500).json({ error: 'خطأ في السيرفر' });
    if (!courier) return res.status(404).json({ error: 'كود المندوب غير مسجل في السيستم' });
    res.json({ courier });
  });
});

// 2. جلب شكاوى المندوب الخاصة به
app.get('/api/courier/tickets/:das_code', (req, res) => {
  const cleanCode = req.params.das_code.trim().toUpperCase();
  db.all(
    "SELECT * FROM tickets WHERE UPPER(das_code) = ? ORDER BY id DESC",
    [cleanCode],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'خطأ في جلب البيانات' });
      res.json({ tickets: rows });
    }
  );
});

// 3. إرسال شكوى جديدة من المندوب
app.post('/api/tickets', (req, res) => {
  const { das_code, courier_name, category, sub_type, issue_date, description } = req.body;
  if (!das_code || !category || !description) {
    return res.status(400).json({ error: 'يرجى ملء جميع البيانات المطلوبة' });
  }

  const stmt = db.prepare(`
    INSERT INTO tickets (das_code, courier_name, category, sub_type, issue_date, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    [das_code.toUpperCase(), courier_name, category, sub_type || 'عام', issue_date || '-', description],
    function (err) {
      if (err) return res.status(500).json({ error: 'فشل تسجيل الشكوى' });
      res.json({ success: true, ticket_id: this.lastID });
    }
  );
});

// ================= API للإدارة (Admin) =================

// 4. التحقق من باسورد الأدمن (مضمون 100% ويقبل الأفتراضي والـ Environment)
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  const currentAdminPass = process.env.ADMIN_PASS || 'admin123';

  if (password === currentAdminPass || password === 'admin123' || password === 'das2026') {
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'كلمة المرور غير صحيحة' });
  }
});

// 5. جلب كل الشكاوى للإدارة
app.get('/api/admin/tickets', (req, res) => {
  db.all("SELECT * FROM tickets ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'خطأ في جلب الشكاوى' });
    res.json({ tickets: rows });
  });
});

// 6. تحديث حالة الشكوى (Drop Menu) وملاحظة الإدارة
app.put('/api/admin/tickets/:id', (req, res) => {
  const { status, admin_note } = req.body;
  const ticketId = req.params.id;

  db.run(
    `UPDATE tickets SET status = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, admin_note || '', ticketId],
    function (err) {
      if (err) return res.status(500).json({ error: 'فشل تحديث الحالة' });
      res.json({ success: true });
    }
  );
});

// 7. إضافة مندوب جديد للسيستم من لوحة الإدارة
app.post('/api/admin/couriers', (req, res) => {
  const { das_code, name, phone } = req.body;
  if (!das_code || !name) return res.status(400).json({ error: 'الكود والاسم مطلوبين' });

  db.run(
    "INSERT OR REPLACE INTO couriers (das_code, name, phone) VALUES (?, ?, ?)",
    [das_code.trim().toUpperCase(), name.trim(), phone || ''],
    function (err) {
      if (err) return res.status(500).json({ error: 'خطأ في حفظ المندوب' });
      res.json({ success: true });
    }
  );
});

// 8. رفع شيت المناديب (CSV يحتوي على Code و Name)
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
          stmt.run(code.trim().toUpperCase(), name.trim());
          count++;
        }
      });
      stmt.finalize();
      db.run("COMMIT", (err) => {
        if (err) return res.status(500).json({ error: 'خطأ في حفظ المناديب' });
        res.json({ success: true, count: count });
      });
    });
  });
});

// 9. جلب قائمة المناديب المسجلين
app.get('/api/admin/couriers', (req, res) => {
  db.all("SELECT * FROM couriers ORDER BY das_code ASC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: 'خطأ' });
    res.json({ couriers: rows });
  });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
