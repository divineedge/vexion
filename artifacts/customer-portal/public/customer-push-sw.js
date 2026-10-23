/* Customer portal push reminders. Payloads carry generic visit details only. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function safePortalUrl(raw) {
  try {
    const url = new URL(raw || '/portal/', self.location.origin);
    if (url.origin !== self.location.origin) return null;
    if (!url.pathname.startsWith('/portal/')) return null;
    return url.href;
  } catch (e) {
    return null;
  }
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Upcoming visit';
  const body = typeof data.body === 'string' ? data.body : 'You have an upcoming service visit.';
  const url = safePortalUrl(typeof data.url === 'string' ? data.url : '') || new URL('/portal/', self.location.origin).href;
  event.waitUntil(self.registration.showNotification(title, { body, data: { url } }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = safePortalUrl(event.notification.data && event.notification.data.url);
  if (!target) return;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url === target && 'focus' in c) return c.focus();
    }
    return self.clients.openWindow(target);
  })());
});
