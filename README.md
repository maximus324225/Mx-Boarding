# MX Boarding – 3D-Snowboard-Spiel für den Browser

Snowboarden auf einem Alpenberg mit Snowpark, Saltos, Rails und vier Spielmodi.
Läuft am PC und auf dem Handy, komplett im Browser.

## Spielmodi

| Modus | Ziel |
|---|---|
| **Freeride** | Endlos durch den Snowpark. 3 Leben, Punkte für Meter und Tricks. |
| **Trick-Attack** | 2 Minuten im Snowpark: so viele Trick-Punkte wie möglich. Stürze kosten nur Zeit. |
| **Slalom** | 30 Tore bis ins Ziel. Jedes verpasste Tor: +3 Strafsekunden. |
| **Freies Fahren** | Ohne Leben, ohne Zeitdruck – einfach fahren und üben. |

Rekorde werden pro Modus im Browser gespeichert.

## Steuerung

| PC | Handy | Aktion |
|---|---|---|
| ← → oder A D | ◀ ▶ oder Handy neigen (📱) | Lenken (Carven gibt Schwung) / in der Luft drehen |
| ↑ oder W | Hocke | Hocke · in der Luft: Vorwärtssalto (PC) bzw. Grab (Handy) |
| ↓ oder S | Bremsen | Bremsen · in der Luft: Rückwärtssalto |
| Leertaste halten + loslassen | Sprung halten + loslassen | Sprung (länger halten = höher) |
| Shift oder E | – | Grab in der Luft |
| C | 🎥 | Kamera: hinten, nah, vorne, seitlich, von oben |
| M | 🎵 | Musik an/aus |
| Esc / P | ⏸ | Pause |

**Lande-Hilfe:** Lässt man in der Luft los, dreht sich der Fahrer automatisch zur
nächsten sauberen Landeposition – Spins und Saltos werden „fertig gedreht“.

## Projekt starten (auf deinem eigenen Computer)

1. [Node.js](https://nodejs.org) installieren (Version 20 oder neuer).
2. Im Projektordner ein Terminal öffnen und einmalig ausführen:
   ```bash
   npm install
   ```
3. Spiel starten:
   ```bash
   npm run dev
   ```
   Dann die angezeigte Adresse (z. B. `http://localhost:5173`) im Browser öffnen.
   Die zweite angezeigte Adresse (`Network: …`) funktioniert auch auf dem Handy im selben WLAN.
4. Fertige Version zum Hochladen bauen: `npm run build` (Ergebnis liegt im Ordner `dist/`).

## Aufbau des Codes

| Datei | Inhalt |
|---|---|
| `index.html` | Seite, Startbildschirm mit Logo, Menüs, Anzeige, Touch-Buttons |
| `src/main.js` | Hauptprogramm: Grafikstufen, Licht, Spielmodi, Punkte, Spielschleife |
| `src/attract.js` | Show-Fahrt im Startbildschirm (Autopilot + Kino-Kamera) |
| `src/terrain.js` | Form des Berges, Pistenverlauf, Snowpark-Elemente, Slalom-Tore |
| `src/world.js` | Erzeugt Gelände, Bäume, Felsen, Park stückweise; Schnee-Glitzern |
| `src/details.js` | Sessellift, Schneekanonen, Berghütten, Slalom-Tore, Zielbogen |
| `src/player.js` | Fahrphysik: Carving-Boost, Sprünge, Saltos, Spins, Grinds, Lande-Hilfe |
| `src/rider.js` | Snowboarder-Figur nach Vorlage mit Gelenken und Posen |
| `src/mountains.js` | Alpines Bergpanorama |
| `src/sky.js` | Blauer Himmel mit Sonne und Wolken |
| `src/camera.js` | Kamera mit 5 Ansichten |
| `src/input.js` | Tastatur, Touch und Neigungssensor |
| `src/effects.js` | Schnee-Spray, Spuren im Schnee, Schneeglitzern in der Luft |
| `src/audio.js` | Soundeffekte (Wind, Kante, Rutschen, Grind, Landung, Sturz …) |
| `src/music.js` | Titelmusik, live im Browser erzeugt |
| `src/style.css` | Aussehen von Logo, Menüs und Anzeige |

Technik: [Three.js](https://threejs.org) (3D) und [Vite](https://vite.dev) (Entwicklungsserver).
