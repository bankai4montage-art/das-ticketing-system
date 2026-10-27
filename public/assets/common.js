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
    refresh: '<path d="M21 12a9 9 0 0 0-15-6.7L3 8"/><path d="M3 3v5h5M3 12a9 9 0 0 0 15 6.7l3-2.7"/><path d="M16 16h5v5"/>'
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

    esc(v) {
      return String(v == null ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

  document.addEventListener('DOMContentLoaded', () => DAS.hydrateIcons());
})();
