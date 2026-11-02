// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 OpenLance
// Makes the site installable as the ROBOLANCE app. Pages always come from the
// network, so a new deploy shows at once; the last copy of each page is kept
// only to open it when the phone is offline. Runs and the API are never cached.
const CACHE = 'robolance-pages-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
    event.waitUntil(caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.mode !== 'navigate' || new URL(req.url).origin !== self.location.origin) {
        return;
    }
    event.respondWith(fetch(req).then((res) => {
        if (res.ok) {
            const copy = res.clone();
            const key = new URL(req.url).pathname;
            caches.open(CACHE).then((cache) => cache.put(key, copy)).catch(() => undefined);
        }
        return res;
    }).catch(() => caches.match(new URL(req.url).pathname).then((hit) => hit || Response.error())));
});
