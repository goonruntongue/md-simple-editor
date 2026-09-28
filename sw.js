/*
 * Service Worker - オフラインでも使えるようにアプリの部品をキャッシュする
 * ファイルを更新したら CACHE の番号を上げると、古いキャッシュが入れ替わります。
 */
var CACHE = 'md-learn-v1';
var ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/markdown.js',
  'js/data.js',
  'js/app.js',
  'images/app-icon.svg',
  'images/sample-cat.svg',
  'images/sample-mountain.svg',
  'images/sample-coffee.svg',
  'images/sample-flower.svg',
  'images/sample-city.svg',
  'images/sample-banner.svg',
  'images/icon-star.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-192.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) { return cache.addAll(ASSETS); }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// キャッシュをすぐ返しつつ、裏で最新版を取りに行く（stale-while-revalidate）
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(function () {
          if (cached) return cached;
          if (req.mode === 'navigate') return cache.match('index.html');
          return Response.error();
        });
        if (cached) {
          event.waitUntil(network.catch(function () {}));
          return cached;
        }
        return network;
      });
    })
  );
});
