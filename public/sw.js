// Service worker: solo muestra el aviso diario de "Reporte actualizado"
self.addEventListener('push', e => {
  let d = {}; try { d = e.data.json(); } catch { d = { body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Motomundo Campañas', {
    body: d.body || '', icon: '/favicon-512.png', badge: '/favicon-32.png', tag: 'reporte-diario', renotify: true,
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    const w = ws.find(c => c.url.startsWith(self.location.origin));
    return w ? w.focus() : clients.openWindow('/');
  }));
});
