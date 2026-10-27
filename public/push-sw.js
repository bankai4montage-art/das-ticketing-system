// Service Worker بتاع الإشعارات — بيستقبل الـ push ويعرضه كإشعار نظام
self.addEventListener('push', (e) => {
  let data = {};
  try { data = e.data.json(); } catch (err) { /* payload مش JSON */ }
  e.waitUntil(self.registration.showNotification(data.title || 'DAS Portal', {
    body: data.body || '',
    icon: '/assets/favicon.svg',
    badge: '/assets/favicon.svg',
    dir: 'rtl',
    lang: 'ar',
    vibrate: [80, 40, 80],
    data: { url: data.url || '/index.html' }
  }));
});

// الضغط على الإشعار بيفتح/يرجّع تاب البورتال
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/index.html';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (c.url.includes(self.location.host)) {
        c.focus();
        return;
      }
    }
    return clients.openWindow(url);
  }));
});
