/* DAS Portal — shared helpers */
(function () {
  // ---- Theme (applied ASAP to avoid flash) ----
  try {
    const t = localStorage.getItem('das_theme');
    if (t) document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}

  const ICONS = {
    calendar: '<rect x="3" y="4" width="18" height="18" rx="3"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    wallet: '<path d="M20 12V8a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h12"/><path d="M3 5v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    id: '<rect x="2" y="5" width="20" height="14" rx="3"/><circle cx="8" cy="12" r="2"/><path d="M13 10h5M13 14h4"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    send: '<path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
    inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3"/>',
    arrow: '<path d="m15 18-6-6 6-6"/>',
    msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    refresh: '<path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5M3 12a9 9 0 0 0 15 6.7l3-2.7"/><path d="M16 16h5v5"/>',
    trash: '<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14"/><path d="M10 11v6M14 11v6"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5M12 3v12"/>',
    banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
    star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    bellOff: '<path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18.63 13A17.89 17.89 0 0 1 18 8"/><path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 8a6 6 0 0 0-9.33-5"/><path d="M1 1l22 22"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    chev: '<path d="M6 9l6 6 6-6"/>'
  };

  window.DAS = {
    icon(name, cls) {
      return `<svg class="ico ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    },

    // Replace <i data-ico="name" data-cls="ico-lg"></i> with inline SVG
    hydrateIcons(root) {
      (root || document).querySelectorAll('[data-ico]').forEach((el) => {
        el.outerHTML = this.icon(el.dataset.ico, el.dataset.cls);
      });
    },

    // سلاسة السكرول: أثناء السكرول بنوقف حركة خلفية الأوربس (عشان backdrop-filter يبقى رخيص)
    // وبعد ما يقف بننادي onEnd عشان الرندر المؤجل يتعمل
    scrollCalm(onEnd) {
      let t = null;
      const root = document.documentElement;
      window.addEventListener('scroll', () => {
        root.classList.add('scrolling');
        clearTimeout(t);
        t = setTimeout(() => {
          root.classList.remove('scrolling');
          if (onEnd) onEnd();
        }, 180);
      }, { passive: true });
    },

    isScrolling() {
      return document.documentElement.classList.contains('scrolling');
    },

    // ===== Dropdown مخصوص بديل الـ select الأصلي (شكل الوندوز القديم) =====
    // البيج بيسابد ddChanged(id, value) لو عايز يتصرف عند الاختيار
    ddChanged: null,
    _dd: null, // { dd, list } — القايمة المفتوحة (المزروعة في body)

    ddOpen() { return !!this._dd; },

    closeDd() {
      if (!this._dd) return;
      const dd = this._dd.dd, list = this._dd.list;
      dd.classList.remove('open');
      list.classList.remove('dd-floating');
      if (list.parentNode !== dd) dd.appendChild(list);
      list.style.cssText = '';
      this._dd = null;
    },

    ddHtml(id, value, options, clsMap, labelFn) {
      const cls = (o) => (clsMap && clsMap[o] ? ' ' + clsMap[o] : '');
      const lbl = (o) => this.esc(labelFn ? labelFn(o) : o);
      const items = options.map(o =>
        `<button type="button" class="dd-item${cls(o)}${o === value ? ' active' : ''}" data-value="${this.esc(o)}"
          onclick="DAS.ddPick(event, '${id}', this.dataset.value)"><span class="dd-dot${cls(o)}"></span>${lbl(o)}</button>`
      ).join('');
      return `<div class="dd" id="${id}" data-value="${this.esc(value)}">
        <button type="button" class="dd-btn${cls(value)}" onclick="DAS.ddToggle(event, '${id}')">
          <span class="dd-dot${cls(value)}"></span><span class="dd-label">${lbl(value)}</span>${this.icon('chev', 'dd-chev')}
        </button>
        <div class="dd-list" role="listbox">${items}</div>
      </div>`;
    },

    ddToggle(ev, id) {
      ev.stopPropagation();
      const dd = document.getElementById(id);
      if (!dd) return;
      if (this._dd) {
        const same = this._dd.dd === dd;
        this.closeDd();
        if (same) return;
      } else if (dd.classList.contains('open')) {
        dd.classList.remove('open');
        return;
      }
      dd.classList.add('open');
      const list = dd.querySelector('.dd-list');
      if (dd.hasAttribute('data-inline')) return; // جوا مودال — absolute عادي
      // بنزرع القايمة في body بمكان ثابت عشان ما تتقصش مع overflow بتاع الجدول
      document.body.appendChild(list);
      list.classList.add('dd-floating');
      list.style.position = 'fixed';
      list.style.visibility = 'hidden';
      const r = dd.querySelector('.dd-btn').getBoundingClientRect();
      const lw = list.offsetWidth, lh = list.offsetHeight;
      let top = r.bottom + 6;
      if (top + lh > window.innerHeight - 8) top = Math.max(8, r.top - lh - 6);
      let right = window.innerWidth - r.right;
      if (right + lw > window.innerWidth - 8) right = Math.max(8, window.innerWidth - lw - 8);
      list.style.top = top + 'px';
      list.style.right = right + 'px';
      list.style.left = 'auto';
      list.style.visibility = '';
      this._dd = { dd, list };
    },

    ddPick(ev, id, value) {
      ev.stopPropagation();
      const dd = document.getElementById(id);
      if (!dd) return;
      dd.dataset.value = value;
      const item = dd.querySelector('.dd-item[data-value="' + value + '"]');
      if (item) {
        dd.querySelectorAll('.dd-item').forEach(x => x.classList.toggle('active', x.dataset.value === value));
        const dot = dd.querySelector('.dd-btn .dd-dot');
        const btn = dd.querySelector('.dd-btn');
        ['ok', 'warn', 'bad'].forEach(c => {
          if (item.classList.contains(c)) { dot.classList.add(c); btn.classList.add(c); }
          else { dot.classList.remove(c); btn.classList.remove(c); }
        });
        // الليبل من نص العنصر نفسه (عشان يعرض الاسم المنسق مش المفتاح)
        dd.querySelector('.dd-btn .dd-label').textContent = item.textContent.trim();
      } else {
        dd.querySelector('.dd-btn .dd-label').textContent = value;
      }
      this.closeDd();
      if (typeof this.ddChanged === 'function') this.ddChanged(id, value);
    },

    esc(v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    },

    // الداتابيز بتخزن UTC — العرض دايماً بتوقيت القاهرة (بيظبط التوقيت الصيفي لوحده)
    parseUtc(s) {
      const d = new Date(String(s || '').replace(' ', 'T') + 'Z');
      return isNaN(d) ? null : d;
    },

    fmtDateTime(s) {
      const d = this.parseUtc(s);
      if (!d) return String(s || '');
      return d.toLocaleString('ar-EG', { timeZone: 'Africa/Cairo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    },

    fmtMonthKey(s) {
      const d = this.parseUtc(s);
      if (!d) return '';
      return d.toLocaleString('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit' });
    },

    fmtMonthLabel(key) {
      const parts = String(key || '').split('-').map(Number);
      if (parts.length !== 2 || parts.some(isNaN)) return key;
      return new Date(Date.UTC(parts[0], parts[1] - 1, 15)).toLocaleDateString('ar-EG', { timeZone: 'Africa/Cairo', month: 'long', year: 'numeric' });
    },

    // CSV بمحارف معلّمة عشان Excel يفتحه عربي صح
    csvCell(v) {
      return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    },

    downloadCsv(filename, rows) {
      const csv = '\uFEFF' + rows.map(r => r.map(this.csvCell).join(',')).join('\r\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },

    initials(name) {
      const p = String(name || '?').trim().split(/\s+/);
      return ((p[0] || '')[0] || '?') + ((p[1] || '')[0] || '');
    },

    // Stable gradient from a string
    gradient(seed) {
      let h = 0;
      for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) % 360;
      return `linear-gradient(135deg, hsl(${h} 75% 58%), hsl(${(h + 50) % 360} 75% 52%))`;
    },

    toast(msg, type) {
      let box = document.getElementById('toasts');
      if (!box) {
        box = document.createElement('div');
        box.id = 'toasts'; box.className = 'toasts';
        document.body.appendChild(box);
      }
      const el = document.createElement('div');
      el.className = 'toast ' + (type === 'err' ? 'err' : 'ok');
      el.innerHTML = this.icon(type === 'err' ? 'alert' : 'checkCircle') + '<span>' + this.esc(msg) + '</span>';
      box.appendChild(el);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 380); }, 2800);
    },

    countUp(el, to, ms) {
      const from = parseInt(el.textContent, 10) || 0;
      if (from === to) { el.textContent = to; return; }
      const start = performance.now();
      const dur = ms || 800;
      const tick = (now) => {
        const p = Math.min(1, (now - start) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(from + (to - from) * e);
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },

    confetti() {
      const colors = ['#6366f1', '#8b5cf6', '#34d399', '#fbbf24', '#fb7185', '#38bdf8'];
      const box = document.createElement('div');
      box.className = 'confetti';
      for (let i = 0; i < 36; i++) {
        const p = document.createElement('i');
        p.style.background = colors[i % colors.length];
        p.style.setProperty('--x', (Math.random() * 520 - 260) + 'px');
        p.style.setProperty('--y', (Math.random() * 420 - 120) + 'px');
        p.style.setProperty('--r', (Math.random() * 720 - 360) + 'deg');
        p.style.animationDelay = (Math.random() * 0.12) + 's';
        box.appendChild(p);
      }
      document.body.appendChild(box);
      setTimeout(() => box.remove(), 1500);
    },

    toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', cur);
      try { localStorage.setItem('das_theme', cur); } catch (e) {}
    },

    toggleLang(lang) {
      const cur = lang || (localStorage.getItem('das_lang') === 'en' ? 'ar' : 'en');
      localStorage.setItem('das_lang', cur);
      document.documentElement.lang = cur;
      document.documentElement.dir = cur === 'ar' ? 'rtl' : 'ltr';
      // Simple translation for key UI elements
      const dict = {
        ar: {
          'Overview': 'نظرة عامة', 'Daily Attendance': 'الحضور اليومي', 'Schedule': 'الجدول', 'Employees': 'الموظفون', 'Reports': 'التقارير', 'Fines': 'الغرامات', 'Settings': 'الإعدادات',
          'Search employee...': 'ابحث عن موظف...', 'Previous week': 'الأسبوع السابق', 'Next week': 'الأسبوع التالي', 'Current week': 'الأسبوع الحالي',
          'Saturday': 'السبت', 'Sunday': 'الأحد', 'Monday': 'الاثنين', 'Tuesday': 'الثلاثاء', 'Wednesday': 'الأربعاء', 'Thursday': 'الخميس', 'Friday': 'الجمعة',
          'Present': 'حاضر', 'Late': 'متأخر', 'Absent': 'غائب', 'Excused': 'بعذر', 'Not marked': 'لم يُسجل',
          'Overview': 'نظرة عامة', 'Daily Attendance': 'الحضور اليومي', 'Schedule': 'الجدول', 'Employees': 'الموظفون', 'Reports': 'التقارير', 'Fines': 'الغرامات', 'Settings': 'الإعدادات',
        },
        en: {
          'نظرة عامة': 'Overview', 'الحضور اليومي': 'Daily Attendance', 'الجدول': 'Schedule', 'الموظفون': 'Employees', 'التقارير': 'Reports', 'الغرامات': 'Fines', 'الإعدادات': 'Settings',
          'ابحث عن موظف...': 'Search employee...', 'الأسبوع السابق': 'Previous week', 'الأسبوع التالي': 'Next week', 'الأسبوع الحالي': 'Current week',
          'السبت': 'Saturday', 'الأحد': 'Sunday', 'الاثنين': 'Monday', 'الثلاثاء': 'Tuesday', 'الأربعاء': 'Wednesday', 'الخميس': 'Thursday', 'الجمعة': 'Friday',
          'حاضر': 'Present', 'متأخر': 'Late', 'غائب': 'Absent', 'بعذر': 'Excused', 'لم يُسجل': 'Not marked',
          'نظرة عامة': 'Overview', 'الحضور اليومي': 'Daily Attendance', 'الجدول': 'Schedule', 'الموظفون': 'Employees', 'التقارير': 'Reports', 'الغرامات': 'Fines', 'الإعدادات': 'Settings',
        }
      };
      const t = dict[cur] || dict.ar;
      document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) el.textContent = t[key];
      });
      document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (t[key]) el.placeholder = t[key];
      });
      document.documentElement.lang = cur;
      document.documentElement.dir = cur === 'ar' ? 'rtl' : 'ltr';
    },

    // Button loading helper
    busy(btn, on) {
      btn.classList.toggle('loading', !!on);
      btn.disabled = !!on;
    },

    // Cursor-follow glow on cards
    glow(selector) {
      document.querySelectorAll(selector).forEach((c) => {
        c.addEventListener('pointermove', (e) => {
          const r = c.getBoundingClientRect();
          c.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100) + '%');
          c.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100) + '%');
        });
      });
    }
  };


  // ---- dynamic translation helper (AR <-> EN) ----
  const TICK_TRANS = [];
  function T(s){ if (document.documentElement.lang !== 'en') return s; return s; }

  function translateTree(root) {
    if (!root) return;
    try {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let n;
      while ((n = walker.nextNode())) {
        if (n.parentNode && n.parentNode.nodeName !== 'SCRIPT' && n.parentNode.nodeName !== 'STYLE') {
          const v = n.nodeValue;
          const t = (v || '').trim();
          if (t && DAS._dict && DAS._dict[t] && t !== DAS._dict[t]) {
            n.nodeValue = v.replace(t, DAS._dict[t]);
          }
        }
      }
      root.querySelectorAll && root.querySelectorAll('*').forEach(el => {
        ['placeholder','title','aria-label'].forEach(a => {
          if (el.hasAttribute(a)) {
            const v = el.getAttribute(a);
            if (DAS._dict && DAS._dict[v]) el.setAttribute(a, DAS._dict[v]);
          }
        });
      });
    } catch (e) {}
  }

  // expose dict reference (populated by toggleLang)
  DAS._dict = {};

  document.addEventListener('DOMContentLoaded', () => { DAS.hydrateIcons(); const l = localStorage.getItem('das_lang'); if (l === 'en') DAS.toggleLang('en'); });

  // قفل الـ dropdown لما تدوس بره / resize / scroll / Escape
  document.addEventListener('click', (e) => {
    if (DAS.ddOpen() && !DAS._dd.list.contains(e.target)) DAS.closeDd();
  });
  window.addEventListener('resize', () => DAS.closeDd());
  window.addEventListener('scroll', () => DAS.closeDd(), { passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && DAS.ddOpen()) {
      e.stopImmediatePropagation();
      DAS.closeDd();
    }
  });
})();
