// Service worker: shows the pushes the backend sends when a block starts or
// runs out (backend/app/push.py), and brings the app up when one is clicked.
// Subscribing happens in src/push.ts.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // not JSON — show the generic title
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'SpeedRun Tasks', {
      body: data.body || '',
      // The same block's push replaces its earlier one instead of stacking.
      tag: data.tag,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin);
      if (open) return open.focus();
      return self.clients.openWindow('/');
    })()
  );
});
