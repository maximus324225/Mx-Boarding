# Powder Run – 3D-Snowboard-Spiel für den Browser

Realistisches Snowboard-Spiel mit endlosem Berg, Schanzen, Tricks und Steuerung für PC und Handy.

## Steuerung

| PC | Handy | Aktion |
|---|---|---|
| ← → oder A D | ◀ ▶ oder Handy neigen (📱) | Lenken / in der Luft drehen |
| ↑ oder W | Hocke | Schneller fahren / Grab in der Luft |
| ↓ oder S | Bremsen | Bremsen (Board querstellen) |
| Leertaste halten + loslassen | Sprung halten + loslassen | Sprung (länger halten = höher) |
| Esc / P | ⏸ | Pause |

**Regeln:** 3 Leben. Bäume, Felsen und Landungen quer zur Fahrtrichtung kosten ein Leben.
Punkte gibt es für gefahrene Meter, Flugzeit, Drehungen (180°, 360° …) und Grabs.

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
| `index.html` | Seite, Menüs, Anzeige, Touch-Buttons |
| `src/main.js` | Hauptprogramm, Licht, Himmel, Spielschleife, Punkte |
| `src/terrain.js` | Form des Berges, Pistenverlauf, Schanzen |
| `src/world.js` | Erzeugt Gelände, Bäume, Felsen, Stangen stückweise |
| `src/player.js` | Snowboarder-Figur und Fahrphysik |
| `src/camera.js` | Verfolgerkamera |
| `src/input.js` | Tastatur, Touch und Neigungssensor |
| `src/effects.js` | Schnee-Spray und Schneefall |
| `src/audio.js` | Wind- und Schneegeräusche |
| `src/style.css` | Aussehen der Menüs und Anzeige |

Technik: [Three.js](https://threejs.org) (3D) und [Vite](https://vite.dev) (Entwicklungsserver).
