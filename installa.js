/* Installazione come app (PWA), uguale in Word, Excel, Metal Gear e Radente.
   - Registra sw.js (copia dei file per aprirsi anche senza rete).
   - Aperta con ?installa (link «Installa» del portfolio Nemesi Web) mostra un riquadro:
     pulsante «Installa» dove il browser lo permette (Chrome, Edge, Android),
     altrimenti i passi da fare (iPhone e iPad, Safari su Mac, Firefox).
   Impostazioni sul tag <script>: data-nome (nome dell'app), data-colore (accento). */
(function () {
  var tag = document.currentScript;
  var NOME = (tag && tag.dataset.nome) || document.title;
  var COLORE = (tag && tag.dataset.colore) || '#CDFD67';
  var web = /^https?:$/.test(location.protocol);

  if (web && 'serviceWorker' in navigator) {
    addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  var giaApp = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  var richiesta = /[?&]installa\b/.test(location.search);
  var evento = null, riquadro = null, attesa = null;

  addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); evento = e;
    if (riquadro) mostraPulsante();
  });
  addEventListener('appinstalled', function () { evento = null; if (riquadro) fatto(); });

  if (!richiesta || !web) return;
  // il parametro serve una volta sola: toglierlo evita che il riquadro torni ricaricando o dall'icona installata
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}

  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var android = /Android/.test(ua);
  var firefox = /Firefox|FxiOS/.test(ua);
  var safariMac = !ios && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
  var chromium = /Chrome|Chromium|Edg\//.test(ua) && !ios;

  var CONDIVIDI = '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" style="vertical-align:-3px"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function passi() {
    if (giaApp) return '<p>Stai già usando ' + NOME + ' come app.</p>';
    if (ios) return '<ol><li>Tocca <b>Condividi</b> ' + CONDIVIDI + ' nella barra del browser</li>' +
      '<li>Scegli <b>Aggiungi alla schermata Home</b></li><li>Tocca <b>Aggiungi</b></li></ol>';
    if (safariMac) return '<ol><li>Nel menu in alto apri <b>Archivio</b></li><li>Scegli <b>Aggiungi al Dock</b></li>' +
      '<li>Fai clic su <b>Aggiungi</b>: ' + NOME + ' compare nel Dock e in Applicazioni</li></ol>';
    if (firefox && !android) return '<p>Firefox per computer non installa le app web. Apri questa pagina con <b>Chrome</b>, <b>Edge</b> o <b>Safari</b> e scegli di nuovo «Installa».</p>';
    if (android) return '<ol><li>Apri il menu <b>⋮</b> del browser</li><li>Scegli <b>Installa app</b> oppure <b>Aggiungi a schermata Home</b></li></ol>';
    if (chromium) return '<ol><li>Fai clic sull\'icona di installazione a destra nella barra dell\'indirizzo</li>' +
      '<li>Oppure apri il menu <b>⋮</b> e scegli <b>Trasmetti, salva e condividi › Installa pagina come app</b></li></ol>';
    return '<p>Cerca nel menu del browser la voce <b>Installa</b> oppure <b>Aggiungi alla schermata Home</b>.</p>';
  }

  function crea() {
    var css = document.createElement('style');
    css.textContent =
      '#pwa-ins{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:flex-end;justify-content:center;padding:16px;' +
      'background:rgba(0,0,0,.45);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#eceee9;' +
      '-webkit-user-select:text;user-select:text;touch-action:auto;animation:pwa-in .25s ease-out}' +
      '@media (min-width:640px){#pwa-ins{align-items:center}}' +
      '#pwa-ins .box{position:relative;width:min(400px,100%);background:#17191a;border:1px solid rgba(255,255,255,.1);border-radius:18px;' +
      'padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.5)}' +
      '#pwa-ins .testa{display:flex;align-items:center;gap:14px;margin:0 32px 14px 0}' +
      '#pwa-ins img{width:52px;height:52px;border-radius:12px;flex:none}' +
      '#pwa-ins h2{margin:0;font-size:18px;font-weight:650;letter-spacing:-.01em;color:#fff}' +
      '#pwa-ins .sotto{margin:2px 0 0;font-size:13px;color:#a9ada6}' +
      '#pwa-ins ol{margin:0;padding-left:20px}#pwa-ins li{margin:5px 0}#pwa-ins p{margin:0}#pwa-ins b{color:#fff;font-weight:600}' +
      '#pwa-ins .azioni{display:flex;gap:10px;margin-top:18px}' +
      '#pwa-ins button{font:inherit;font-weight:600;border-radius:11px;height:44px;padding:0 18px;cursor:pointer;border:0}' +
      '#pwa-ins .si{flex:1;background:' + COLORE + ';color:#111}#pwa-ins .si[hidden]{display:none}' +
      '#pwa-ins .no{background:rgba(255,255,255,.08);color:#eceee9}' +
      '#pwa-ins .x{position:absolute;top:12px;right:12px;width:34px;height:34px;padding:0;border-radius:50%;background:transparent;color:#a9ada6;font-size:22px;line-height:1}' +
      '#pwa-ins button:focus-visible{outline:2px solid ' + COLORE + ';outline-offset:2px}' +
      '@keyframes pwa-in{from{opacity:0}}@media (prefers-reduced-motion:reduce){#pwa-ins{animation:none}}';
    document.head.appendChild(css);

    var icona = (document.querySelector('link[rel="apple-touch-icon"]') || {}).href || '';
    riquadro = document.createElement('div');
    riquadro.id = 'pwa-ins';
    riquadro.setAttribute('role', 'dialog'); riquadro.setAttribute('aria-modal', 'true'); riquadro.setAttribute('aria-labelledby', 'pwa-tit');
    riquadro.innerHTML = '<div class="box">' +
      '<button class="x" type="button" aria-label="Chiudi">×</button>' +
      '<div class="testa">' + (icona ? '<img src="' + icona + '" alt="">' : '') +
      '<div><h2 id="pwa-tit">Installa ' + NOME + '</h2><p class="sotto">Si apre dalla sua icona, a tutto schermo e anche senza rete.</p></div></div>' +
      '<div class="passi">' + passi() + '</div>' +
      '<div class="azioni"><button class="si" type="button" hidden>Installa</button><button class="no" type="button">Più tardi</button></div></div>';
    document.body.appendChild(riquadro);

    var si = riquadro.querySelector('.si');
    si.addEventListener('click', function () {
      if (!evento) return;
      evento.prompt();
      evento.userChoice.then(function (r) { evento = null; if (r && r.outcome === 'accepted') fatto(); else si.hidden = true; });
    });
    riquadro.querySelector('.no').addEventListener('click', chiudi);
    riquadro.querySelector('.x').addEventListener('click', chiudi);
    riquadro.addEventListener('click', function (e) { if (e.target === riquadro) chiudi(); });
    // i giochi ascoltano la tastiera: finché il riquadro è aperto i tasti restano qui
    riquadro.addEventListener('keydown', function (e) { if (e.key === 'Escape') chiudi(); e.stopPropagation(); });
    if (evento) mostraPulsante();
    (evento ? si : riquadro.querySelector('.no')).focus();
  }

  function mostraPulsante() {
    var si = riquadro.querySelector('.si');
    si.hidden = false;
    riquadro.querySelector('.passi').innerHTML = '<p>Tocca <b>Installa</b>: ' + NOME + ' comparirà tra le tue app.</p>';
    si.focus();
  }
  function fatto() {
    riquadro.querySelector('.passi').innerHTML = '<p>Fatto: ' + NOME + ' è tra le tue app.</p>';
    riquadro.querySelector('.si').hidden = true;
    riquadro.querySelector('.no').textContent = 'Chiudi';
  }
  function chiudi() { clearTimeout(attesa); if (riquadro) { riquadro.remove(); riquadro = null; } }

  function avvia() {
    // Chrome ed Edge annunciano subito se l'app si può installare: un attimo di attesa evita di mostrare i passi a mano per niente
    attesa = setTimeout(crea, chromium && !evento ? 700 : 0);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', avvia); else avvia();
})();
