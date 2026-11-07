/* HØBK er flyttet til https://app.hoebk.dk/ — denne service worker rydder op efter den gamle adresse.
   Den afmelder de gamle notifikationer og fjerner sig selv. Klik på en gammel notifikation åbner den nye adresse. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(self.registration.pushManager.getSubscription()
    .then(function (s) { return s && s.unsubscribe(); }).catch(function () {})
    .then(function () { return self.registration.unregister(); }).catch(function () {}));
});
self.addEventListener('push', function (e) {
  e.waitUntil(self.registration.showNotification('HØBK er flyttet', {
    body: 'Åbn app.hoebk.dk og slå notifikationer til igen på Min side.', icon: 'icon-192.png', data: { url: 'https://app.hoebk.dk/' } }));
});
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(self.clients.openWindow('https://app.hoebk.dk/'));
});
