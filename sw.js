// Guarda o simulador para abrir sem internet depois da primeira visita.
// Usa a rede quando há; sem rede, a última cópia guardada.
// (O nome do cache é próprio: outros apps no mesmo endereço têm o deles.)
const CACHE = 'simulador-interiores';
const ARQUIVOS = ['./', 'simulador.html', 'app/manifest.webmanifest', 'app/icone-192.png', 'app/icone-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
