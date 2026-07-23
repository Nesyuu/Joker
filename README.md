# Joker Hint

A mobile-friendly party card game where players join a room, receive secret cards, and try to find the Joker.

## Firebase Setup

1. Create a Firebase project.
2. Add a Web App in Firebase project settings.
3. Create a Realtime Database.
4. Copy your Firebase Web App config into `public/firebase-config.js`.
5. Add the rules from `database.rules.json` to Realtime Database Rules.

## Run Locally

```bash
npm start
```

Then open `http://localhost:4173`.

## Deploy on Vercel

Use the GitHub repo in Vercel.

```text
Framework Preset: Other
Build Command: npm run build
Output Directory: dist
```

Vercel will host the static game. Firebase Realtime Database stores rooms, players, cards, and votes.
