# Radente

Gioco di volo 3D nel browser (computer e telefono). Piloti un jet che deve attraversare i cerchi seguendo una scia luminosa: più voli basso e vicino agli ostacoli, più punti fai. Due missili per abbattere mine sulla rotta e basi radar a terra. 5 livelli con ambientazioni diverse.
Dettagli e storico versioni in **LEGGIMI.txt**.

- Online con GitHub Pages: https://nemesimark.github.io/radente/ (si aggiorna a ogni push su main).
- Prova in locale: `cd ~/Desktop/Apps/radente && python3 -m http.server 8123` → http://localhost:8123 (serve un server: i moduli JS non partono aprendo il file con doppio clic).
- Prova automatica: aprendo http://localhost:8123/#debug c'è `window.__R` (`start(i)`, `tick(dt)`, `input`, `P`, `run`, `world()`, `weapons`, `render()`, `post`, `camera`, `renderer`) per far volare un pilota automatico e controllare che i percorsi siano volabili. Con `__R.dbg.manual = true` il gioco avanza solo con `tick()` (il pilota automatico può correre più veloce del tempo reale; le animazioni CSS invece restano in tempo reale).
- Three.js 0.160.0 da jsDelivr (importmap in `index.html`, con `three/addons/` per la post-produzione), nessuna installazione.

## Struttura
- `index.html`: schermate (menu, HUD, pausa, risultato, come si gioca) e comandi a tocco.
- `style.css`: grafica dell'interfaccia.
- `js/levels.js`: i livelli (colori, cielo, percorso, cerchi, velocità, ostacoli). Per aggiungere un livello si aggiunge un oggetto qui; `type` sceglie il terreno (`hills`, `canyon`, `city`, `fjord`, `volcano`).
- `js/levels.js` ha anche `look` (solo grafica: esposizione, bloom, colori finali, nuvole, sole, nebbia) e `targets` (quante mine e basi).
- `js/world.js`: costruisce il mondo (terreno a rumore scavato lungo la rotta, cerchi, scia guida, ostacoli, cielo, acqua/lava, luci e ombre).
- `js/targets.js`: mine sulla rotta e basi radar a terra (posizioni, aspetto, distruzione).
- `js/weapons.js`: missili (aggancio, lancio, inseguimento, ricarica, impatti).
- `js/main.js`: ciclo di gioco, volo, punteggio, collisioni, telecamere, HUD, salvataggi (`localStorage` chiave `radente.v1`).
- `js/plane.js`: modello del jet, fiamma, missili sotto le ali, ombra finta (solo grafica leggera). `js/input.js`: tastiera, mouse e comandi a tocco. `js/audio.js`: suoni sintetizzati.
- `js/shade.js`: pezzi di shader in comune (rumore, nebbia atmosferica che sostituisce quella di three.js, limite della luce dei materiali). `js/post.js`: post-produzione (bloom, riflesso del sole, sfocatura del turbo, colori, vignetta). `js/fx.js`: particelle, esplosioni, onde d'urto, detriti, scie, linee di velocità.

## Regole di lavoro
- Rispondi sempre in italiano; LEGGIMI e commenti in italiano.
- A ogni modifica: alza `VERSIONE` in `js/main.js` e aggiungi la voce in fondo a LEGGIMI.txt (sezione VERSIONI).
- Dopo modifiche a percorsi o ostacoli, far girare il pilota automatico (#debug) su tutti i livelli: deve arrivare al traguardo prendendo tutti i cerchi.
- Percorsi, cerchi d'oro e ostacoli nascono dalla sequenza casuale `R()` del livello in `world.js`: non aggiungere, togliere o spostare chiamate a `R()` (per la grafica usare `R2()` o un `rng()` a parte), altrimenti i livelli cambiano. Le stelle e le finestre della 1.2 consumano ancora i loro numeri apposta.
- Grafica: tone mapping ACES; il buffer della scena è a 16 bit (HalfFloat), quindi niente valori enormi o NaN negli shader (diventano rettangoli neri col bloom; `post.js` e `shade.js` li ripuliscono comunque). Niente `smoothstep` con i bordi al contrario: usare `1.0 - smoothstep(a, b, x)`.
- «Grafica leggera» ricarica la pagina (sceglie da capo qualità di ombre, particelle e bloom).
- Repository: https://github.com/nemesiMark/radente (ramo `main`). Commit e push solo su richiesta («g»).

## In sospeso
- Tarare punteggi e soglie delle stelle giocando davvero (ora contano anche mine e basi).
- Provare la grafica 2.0 su un telefono vero (fluidità con e senza «Grafica leggera»).
- Icona per installarlo sul telefono.
