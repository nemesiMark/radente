// Copia dei file dell'app: si apre anche senza rete (installata o no).
// Prima la rete, così gli aggiornamenti arrivano subito; se manca, la copia salvata.
// Cambiare VERSIONE quando cambia l'elenco dei file. Si cancellano solo le copie di quest'app
// (lo stesso indirizzo nemesimark.github.io ospita anche le altre).
const PREFISSO = 'nemesi-radente-';
const VERSIONE = PREFISSO + '1';
const FILE = ['./', 'index.html', 'style.css', 'installa.js', 'manifest.webmanifest', 'js/main.js', 'js/levels.js', 'js/world.js',
  'js/targets.js', 'js/weapons.js', 'js/plane.js', 'js/input.js', 'js/audio.js', 'js/shade.js', 'js/post.js', 'js/fx.js',
  'icone/icona-180.png', 'icone/icona-192.png', 'icone/icona-512.png'];
// librerie e caratteri presi da altri siti: indirizzi con la versione, quindi si usano dalla copia
const FUORI = /^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSIONE).then(c => c.addAll(FILE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(k => Promise.all(k.filter(n => n.startsWith(PREFISSO) && n !== VERSIONE).map(n => caches.delete(n))))
    .then(() => self.clients.claim()));
});

function salva(req, r) {
  if (r && (r.ok || r.type === 'opaque')) { const copia = r.clone(); caches.open(VERSIONE).then(c => c.put(req, copia)); }
  return r;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (!url.pathname.startsWith(new URL('./', self.registration.scope).pathname)) return;
    e.respondWith(fetch(req).then(r => salva(req, r)).catch(() => caches.match(req, { ignoreSearch: true })));
  } else if (FUORI.test(req.url)) {
    e.respondWith(caches.match(req).then(c => c || fetch(req).then(r => salva(req, r))));
  }
});
