# Hornbill Express

Hop across Kuching as Kenyalang the hornbill and deliver kuih lapis before the banjir (flood) catches you. It's a 3D voxel browser game with an angled camera and diagonal lanes, built for an event booth. It runs on PCs, laptops, tablets and phones, and keeps working offline once it has loaded.

## Play locally

```bash
python tools/serve.py
```

Then open the address it prints:

- **Game:** `http://localhost:8000/`
- **TV screen:** `http://localhost:8000/display.html`

Phones and tablets on the same Wi-Fi can use the "same Wi-Fi" address it prints.

## Deploy on GitHub Pages

1. Create a GitHub repository and push this folder to the `main` branch.
2. On GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` now runs `.github/workflows/pages.yml`. It builds the site with `python tools/build.py` and publishes it to `https://<your-user>.github.io/<repo>/`.

To build by hand, run `python tools/build.py`. It writes `dist/`, checks that every file the pages reference exists, and generates the offline service worker.

## Firebase: shared leaderboard and 7-day auto-delete

With Firebase connected, every booth device and the TV screen share one leaderboard and the landmark passports. Without it, everything stays on the device. If the Wi-Fi drops, runs are kept on the device and uploaded automatically when it comes back.

Each score and passport is stored with an `expireAt` date 7 days ahead. Expired records are deleted automatically, in two ways:

- **On the free Spark plan (current setup):** any open booth device or TV page deletes expired records every 30 minutes. The security rules allow a delete only once a record has expired. The game also hides anything older than 7 days straight away, and clears it from each device's own storage.
- **Optionally, on the Blaze plan:** Firestore's own TTL (time-to-live) policy can delete them too, even when no device is open. Google requires billing to be turned on for TTL. To set it up, copy `firestore.indexes.blaze.json` over `firestore.indexes.json` and run `python tools/setup_firebase.py --project hornbill-express --ttl`.

### This repository's project

This repository is already connected to the Firebase project **hornbill-express** (Firestore in `asia-southeast1`, Singapore):

- `firebase.config.json` holds the web config. It isn't secret.
- The security rules are already published.

The steps below are for setting up a different project.

### Set it up (one time, about 10 minutes)

1. Create a project at [console.firebase.google.com](https://console.firebase.google.com).
2. Go to **Build → Firestore Database → Create database** and choose **Production mode** and a region (for example `asia-southeast1`).
3. Go to **Project settings → Your apps → Add app → Web** and copy the `firebaseConfig` object it shows.
4. Give the game that config, in **one** of these ways:
   - **GitHub (recommended):** go to repository **Settings → Secrets and variables → Actions → Variables**, add a variable named `FIREBASE_CONFIG`, and paste the config as JSON (keys in quotes, as in `firebase.config.example.json`).
   - **Local file:** save it as `firebase.config.json` in the project folder. `tools/build.py` picks it up.
   - **By hand:** paste it into `js/firebase-config.js`.
5. Deploy the security rules:
   ```bash
   npm install -g firebase-tools && firebase login
   python tools/setup_firebase.py --project YOUR_PROJECT_ID
   ```
   This deploys `firestore.rules`. If you'd rather not install anything, the script prints the console steps (you paste the rules into Firebase console → Firestore → Rules).
6. Push to GitHub. In the operator panel, the Leaderboard section should say **Connected**.

### What the security rules allow

- **Allowed:** anyone can read the leaderboard. The game can only **add** scores, and only **add** landmarks to a passport.
- **Checked on every write:** names (up to 12 capital letters, digits and spaces), number ranges, the time of the run, and an `expireAt` no more than about 7 days ahead.
- **Not allowed:** nobody can edit records, and a record can only be deleted once it has expired. **Clear leaderboard** in the operator panel hides earlier runs on that device only. To delete shared records early, use the Firebase console.
- **Rude names:** the filter runs in the game, not in Firebase. For a public event, you could also turn on Firebase App Check.

**Cost:** on the free Spark plan an event booth normally stays well within Firestore's daily quota, and there is no card on file, so it can't be charged.

## Setting up the booth

1. Open the game on the booth laptop or tablet.
2. Open the operator panel: press **Ctrl + Shift + O**, or hold the top-left corner of the screen for 5 seconds. Then enter the staff PIN. The default PIN is **1234**; change it in the panel.
3. Turn on **Kiosk mode**. This shows the attract screen with today's top runs, starts a run on any tap or key, and returns to the attract screen after each run.
4. Optional settings:
   - event name and prize line (both off by default)
   - a time limit per run
   - fullscreen lock
   - landmark stamps
   - courier shop
5. For a TV screen, open `display.html` on any device: the same laptop (a second window), or a separate computer or smart TV browser if Firebase is connected. It updates itself.

Settings are saved on each device. Scores and passports are shared through Firebase when it's connected; otherwise each device keeps its own. **Export scores (CSV)** in the operator panel downloads everything.

## How to play

- **Hop:** arrow keys or WASD. Space also hops forward, E drops durian bait, P pauses, M mutes. On touch screens, tap to hop forward or swipe in any direction. An on-screen pad appears automatically on touch screens, and can be turned on or off in Settings.
- **Deliver:** pick up the box of kuih, then hop into the stall marked **DELIVER HERE**. Each delivery earns tips and pushes the flood back.
- **Lives:** you start with 3 lives (up to 5). **Anything that hits you costs a life:** a motorbike, trishaw, market cart or cyclist, a crocodile, falling in the river, missing a roof, being carried off the edge on a boat, or the flood reaching you.
- **After a hit:** you drop the kuih, respawn on the last safe tile with a moment of invincibility, and the flood is pushed back a little. At 0 lives the run ends. Practice runs don't cost lives. Red heart pickups give an extra life.
- **Beat combo:** hop on the kompang beat to build a combo. A higher combo multiplies the tips you earn.
- **Night:** the run cycles from day to night. At night, motorbikes are faster.
- **Forks:** sometimes the path splits. Rooftops are risky but give double tips; the waterfront is safe.
- **Power-ups:**

  | Power-up | Effect |
  | --- | --- |
  | Durian bait | Distracts crocodiles |
  | Payung | Holds back the flood |
  | Wau kite | Glide 2 lanes per hop |
  | Teh tarik | Slows traffic |
  | Rattan helmet | Absorbs one hit (no life lost) |
  | Tiffin carrier | Pulls in nearby tips |

- **Landmarks:** paper stamps appear in runs. Save your name to keep them in your passport. Collecting all 9 unlocks the Sun bear.

## Project layout

```
index.html          game page (all screens)
display.html        TV / live leaderboard page
css/style.css       interface styles
js/config.js        tuning: flood speed, power-ups, landmarks, couriers, default settings
js/world.js         procedural lanes, moving things, pickups
js/game.js          rules: movement, collisions, flood, deliveries, combos
js/render3d.js      3D voxel renderer (Three.js, angled orthographic camera)
js/render.js        2D fallback renderer for devices without WebGL
vendor/three.module.min.js  Three.js r187 (MIT, see vendor/three.LICENSE), bundled so the game works offline
js/audio.js         synthesised sound (sape, kompang, gong, rain) — no audio files
js/main.js          screens, input, kiosk flow, operator panel
js/names.js         name cleaning + rude-word filter (extend the list for your audience)
js/storage.js       scores, passports, settings (local + Firebase)
js/cloud.js         Firebase / Firestore sync, offline queue, 7-day expiry
js/firebase-config.js  your Firebase web config (or null for local only)
firestore.rules     security rules (add-only, validated, no deletes)
firestore.indexes.json  index config (firestore.indexes.blaze.json adds TTL, Blaze plan only)
tools/setup_firebase.py  deploys rules (+ TTL with --ttl on Blaze)
tools/build.py      build for GitHub Pages + offline service worker
tools/serve.py      local server that prints LAN addresses
```

All art is built from voxels in code and all sounds are synthesised, so there are no third-party art or audio assets to license. The only library is Three.js (MIT licence).
