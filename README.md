# 🥗 Calorie Snap

Point your camera at any food → know calories in 10 seconds.

A camera-first calorie tracker PWA built around three frictionless inputs:

- 📷 **Snap** — photo of any cooked meal → Gemini AI estimates kcal + macros
- 📦 **Barcode** — scan packaged food → exact macros from Open Food Facts
- ⌨️ **Search** — type to find 150+ Indian + global foods (offline)

## Features (v1.0)

| Tab | What it does |
|---|---|
| 📷 **Snap** | 3-way input + result confirm/edit panel |
| 📋 **Today** | Ring chart vs daily goal, meal-grouped log, macro bars |
| 📊 **Insights** | 7-day kcal trend, macro split donut, callouts, streak |
| ⚙️ **Settings** | BYO Gemini API key, daily goals, export, wipe |

## Quick start

1. Get a **free Gemini API key** at https://aistudio.google.com/app/apikey (30 sec, no card)
2. Open `index.html` via any HTTPS host (GitHub Pages works perfectly)
3. Paste the key in Settings → Save
4. Tap 📷 → take photo → confirm → log
5. Add to Home Screen for the full PWA experience

## Tech

- 100% client-side PWA — no backend, no hosting cost
- Storage: IndexedDB (local-first)
- Vision: Gemini 2.0 Flash (BYO key, free tier 1,500 req/day)
- Barcode: ZXing + Open Food Facts API
- Charts: Chart.js
- Offline: Service Worker caches the shell + foods DB

## Cost

**$0 / month forever** — you bring your own free Gemini key.

## Honest accuracy

Photo-based calorie estimates carry ±15–25% error. Every value shows `~`
prefix and is editable inline. Bundle of accurate per-100g foods + barcode
exact-match are used wherever possible to reduce reliance on vision.

## File layout

```
calorie-snap-pwa/
├── index.html         # 4-tab shell + modals
├── style.css          # Dark theme, mobile-first
├── app.js             # Core: IndexedDB, tabs, today, goals, settings
├── features.js        # Gemini / barcode / search / insights / edit
├── foods-db.json      # 150+ curated foods (Indian-first)
├── manifest.json      # PWA manifest with quick-add shortcuts
├── sw.js              # Service Worker
├── QA/
│   └── auto-suite.js  # 110 pure-function tests (run: node QA/auto-suite.js)
└── icons/             # PWA icons (192/512)
```

## Test

```bash
node QA/auto-suite.js
# CALORIE SNAP AUTO-SUITE — 110/110 passed (0 failed)
```

## Privacy

- API key stored only in `localStorage`
- Photos sent only to Google's Gemini endpoint, never to us
- All meal data lives on-device (export anytime to JSON)
- One-tap "Clear all data" in Settings

## Roadmap

See `~/.wibey/plans/calorie-snap-prd.md` for full PRD including:
- v1.1: Google Sheets sync (port from Expense Tracker)
- v1.2: Reminders, streaks, weekly digest
- v2.0: Voice add, restaurant menu OCR, meal planning
