// Minimal service worker whose only job is to let the page show notifications
// via ServiceWorkerRegistration.showNotification(). Mobile browsers (notably
// Android Chrome) refuse to construct `new Notification(...)` directly from
// page script and require this path instead; desktop browsers support both,
// but routing through the service worker keeps behavior consistent.
//
// This worker does not cache assets, intercept fetches, or support Web Push;
// it exists solely to receive click events on notifications shown through it
// and relay them back to the page that asked for the notification.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  const tag = event.notification.tag;
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) client.postMessage({ type: "pi-web:notification-click", tag });
      const focusTarget = clients.find((client) => "focus" in client);
      if (focusTarget !== undefined) return focusTarget.focus();
      return self.clients.openWindow("./");
    }),
  );
});
