self.addEventListener('install', (e) => {
  e.waitUntil(caches.open('jf-remote-v2').then(cache => cache.addAll([
    './',
    './index.html',
    './app.js',
    './manifest.webmanifest',
    './icons/icon-192.png',
    './icons/icon-512.png'
  ])));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((resp) => resp || fetch(e.request))
  );
});
