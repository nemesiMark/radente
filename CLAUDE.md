# Radente

Gioco di volo 3D nel browser (computer e telefono). Piloti un aereo che deve attraversare i cerchi seguendo una scia luminosa: più voli basso e vicino agli ostacoli, più punti fai. 5 livelli con ambientazioni diverse.
Dettagli e storico versioni in **LEGGIMI.txt**.

- Online: non ancora pubblicato (si può caricare la cartella su Netlify da https://app.netlify.com/drop: sono solo file statici).
- Prova in locale: `cd ~/Desktop/Apps/radente && python3 -m http.server 8123` → http://localhost:8123 (serve un server: i moduli JS non partono aprendo il file con doppio clic).
- Prova automatica: aprendo http://localhost:8123/#debug c'è `window.__R` (`start(i)`, `tick(dt)`, `input`, `P`, `run`) per far volare un pilota automatico e controllare che i percorsi siano volabili.
- Three.js 0.160.0 da jsDelivr (importmap in `index.html`), nessuna installazione.

## Struttura
- `index.html`: schermate (menu, HUD, pausa, risultato, come si gioca) e comandi a tocco.
- `style.css`: grafica dell'interfaccia.
- `js/levels.js`: i livelli (colori, cielo, percorso, cerchi, velocità, ostacoli). Per aggiungere un livello si aggiunge un oggetto qui; `type` sceglie il terreno (`hills`, `canyon`, `city`, `fjord`, `volcano`).
- `js/world.js`: costruisce il mondo (terreno a rumore scavato lungo la rotta, cerchi, scia guida, ostacoli, cielo, acqua/lava).
- `js/main.js`: ciclo di gioco, volo, punteggio, collisioni, HUD, salvataggi (`localStorage` chiave `radente.v1`).
- `js/plane.js`: modello dell'aereo e ombra. `js/input.js`: tastiera e levetta a tocco. `js/audio.js`: suoni sintetizzati.

## Regole di lavoro
- Rispondi sempre in italiano; LEGGIMI e commenti in italiano.
- A ogni modifica: alza `VERSIONE` in `js/main.js` e aggiungi la voce in fondo a LEGGIMI.txt (sezione VERSIONI).
- Dopo modifiche a percorsi o ostacoli, far girare il pilota automatico (#debug) su tutti i livelli: deve arrivare al traguardo prendendo tutti i cerchi.
- Non è (ancora) un repository git: commit e push solo su richiesta («g»).

## In sospeso
- Tarare punteggi e soglie delle stelle giocando davvero.
- Eventuale pubblicazione online e icona per installarlo sul telefono.
