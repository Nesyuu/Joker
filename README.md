# Joker Hint

A mobile-friendly party card game where players join a room, receive secret cards, and try to find the Joker.

## Run locally

```bash
npm start
```

Then open `http://localhost:4173`.

## Deploy on Cloudflare

- Create a free Cloudflare account.
- Install dependencies with `npm install`.
- Log in with `npx wrangler login`.
- Deploy with `npm run deploy`.

Cloudflare will give you a public URL like:

```text
https://joker-hint.your-name.workers.dev
```

The deployed version uses a Cloudflare Worker plus Durable Objects for game rooms.
