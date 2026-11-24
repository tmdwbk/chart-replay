// 차트게임 서비스 워커: 늘 서버에서 먼저 받고(업데이트 바로 반영), 안 되면 마지막으로 받아 둔 것을 쓴다(잠깐 끊겨도 열림).
// 보안 연결(https 또는 이 컴퓨터 127.0.0.1)에서만 켜진다.
const CACHE = 'chart-game-v1';
self.addEventListener('install', (e) => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true })));
});
