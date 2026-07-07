# 🐝 Swarm Stash

Trade **Neuro-sama** & **Evil Neuro** meme cards with the swarm — like Pokémon cards, but with more *buh*.

- 📦 Rip packs of 4 procedurally-drawn meme cards (⚡100 neuros each, at least one uncommon+ guaranteed)
- ♥ Collect all 38 cards across 5 series: Neuro-sama, Evil Neuro, The Twins, Vedal, Collabs
- ✦ **Foil variants**: 1 in 20 pulls comes out foil — animated rainbow sheen, 4× recycle/trade value
- 🏆 **Achievements** with neuro payouts: pack milestones, trading, foil hunting, and a reward for completing each series
- 👑 **Leaderboard** under the new Ranks tab: swarm clout = binder value (foils ×4) + ⚡100 per achievement (bots don't rank)
- 🤝 Browse other members' binders and propose card-for-card trades (up to 6 per side)
- ⚔️ **Arena**: Pokémon-style turn-based battles — pick 3 cards, stats & a special move derive from each card's hash (foils fight 10% harder), every series beats another in a cycle, optional neuro wager. Bots accept and play instantly; humans battle via challenges
- 💰 **Market**: list cards for neuros; listed cards are locked until sold or delisted
- 📌 **Showcase**: pin up to 6 cards to the top of your public binder
- 🗳️ **Meme of the Week**: weekly vote over community memes — the winner's card gets a permanent rarity upgrade and its creator earns ⚡250
- 🖼️ **Meme submission portal**: players upload real memes (PNG/JPG/GIF/WEBP, max 5MB) which get minted as tradeable cards in the "Swarm Memes" series — credited to the submitter, who receives 2 copies
- 😈 "Corrupt" the whole site into Evil Neuro mode with the theme toggle
- 🤖 Four seeded swarm bots with collections respond to trades instantly — they accept any fair-value offer
- ⚡ Economy: 350 starting neuros, +150 daily claim, recycle duplicates for neuros by rarity

Written in TypeScript with zero runtime dependencies — the server runs its `.ts` files directly on plain Node ≥22.18 (native type stripping), with SQLite storage (built-in `node:sqlite`) in `data/swarm.db`. Schema upgrades from older versions are applied automatically on start.

## Run it

```bash
./setup.sh              # any distro/macOS: installs Node ≥22.18 if needed, writes .env, starts
# or, if you already have Node ≥22.18:
node server.ts          # → http://localhost:3000
# on NixOS: nix run .    (or: nix-shell -p nodejs_22 --run "node server.ts")
```

## Development

TypeScript is a dev-only dependency, used purely for typechecking:

```bash
npm install             # pulls typescript + @types/node
npm run check           # typecheck server (strict) and frontend
```

There is no build step anywhere: the server runs its own `.ts` files natively, and it
serves `public/app.ts` to browsers with the types stripped at request time (Node's
built-in `stripTypeScriptTypes`). Edit `public/app.ts` and reload — that's it.

### Project layout

```
server.ts        entry point — wires the router, starts the http server
routes/          one file per API area; each registers its endpoints on the router
  auth.ts          Discord OAuth + dev login, logout
  site.ts          client config, card catalog, /app.js, meme images, avatars
  players.ts       /api/me, member list, leaderboard, binders, achievements, showcase
  economy.ts       daily claim, pack opening, recycling cards
  memes.ts         meme submission portal, moderation queue, Meme of the Week vote
  trades.ts        card-for-card trades (bots respond instantly)
  battles.ts       arena battles: challenges, turns, wagers, bot opponents
  market.ts        fixed-price listings + auction house
lib/             shared plumbing used by the routes
  config.ts        env vars, admin list, upload limits — all config in one place
  router.ts        tiny :param path router; userGet/userPost require a login
  session.ts       HMAC-signed cookie sessions
  http.ts          sendJSON / err / readBody helpers
  static.ts        static files + type-stripped /app.js
  cardpool.ts      live card pool (catalog + approved memes), pack rolls, card values
  progress.ts      achievement engine (checks, payouts)
  views.ts         shared client-facing JSON shapes
  bots.ts          bot seeding and trade decisions
catalog.ts       the built-in card set, rarities, economy constants
achievements.ts  achievement definitions
battle.ts        combat math (stats, moves, damage)
db.ts            SQLite storage layer (schema, prepared statements, transactions)
env.ts           .env loader (imported first by server.ts)
public/          the SPA: index.html, style.css, app.ts
```

New server modules must use `.ts` import extensions (Node runs them natively) and be
added to git before `nix run` — the flake only packages tracked files.

`setup.sh` tries your package manager first (apt/dnf/pacman/zypper/apk/brew) and otherwise
drops the official Node build into `./.node` — no root needed. `./setup.sh --service`
additionally installs a systemd **user** service; `--help` lists all options.

## Nix flake

- `nix run` — build and start the server (DB is written to `./data` in the current directory; override with `DATA_DIR=…`)
- `nix develop` — dev shell with Node 22
- `nix build` — package at `result/bin/swarm-stash`

Deploy as a NixOS service via the bundled module:

```nix
# flake inputs: swarm-stash.url = "path:/home/pascal/Git/neuro-meme-trading"; (or a git URL)
{
  imports = [ swarm-stash.nixosModules.default ];

  services.swarm-stash = {
    enable = true;
    port = 3000;
    baseUrl = "https://swarm.example.com";   # must match the Discord redirect origin
    environmentFile = "/run/secrets/swarm-stash.env";  # DISCORD_CLIENT_ID/SECRET, SESSION_SECRET
    openFirewall = true;                     # or front it with nginx/caddy instead
  };
}
```

The service runs with `DynamicUser` + systemd hardening and persists its DB in `/var/lib/swarm-stash`.

With no Discord credentials configured, a **dev login** (pick any name) is available on the landing page so you can try everything immediately.

## Discord OAuth setup

1. Create an application at <https://discord.com/developers/applications>
2. Under **OAuth2**, add the redirect: `http://localhost:3000/auth/discord/callback` (use your real domain in production)
3. `cp .env.example .env` and fill in `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, and a `SESSION_SECRET` (`openssl rand -hex 32`)
4. Restart the server — the "Login with Discord" button now works, and each user's Discord display name and avatar carry over (re-synced on every login)

## Meme submissions & moderation

Any logged-in player can upload memes under **Submit**. Rarity is assigned deterministically from the image hash using the normal pack odds, duplicates are rejected by content hash, and only real raster images pass validation (magic-byte checked; SVG is deliberately not allowed).

Set `ADMINS` in `.env` to a comma-separated list of Discord user IDs (or dev-login names) to enable moderation — submissions then wait in a review queue that admins see as an extra "Queue" tab. **With `ADMINS` unset, uploads are minted instantly**, which is fine for local play but not recommended for a public deployment. Uploaded images are stored in `<DATA_DIR>/memes/`.

## Notes

- Trades lock the involved cards until resolved; acceptance re-validates ownership, so stale offers expire instead of duping cards
- To reset the world, stop the server and delete `data/swarm.db` (bots are re-seeded on start)
- Fan project — not affiliated with Vedal or Neuro-sama. Be nice to the tutel.
