// Admin-only management of the built-in card catalog (the `cards` table):
// list / create / edit / delete lore cards. Every handler is gated by
// isAdmin (the ADMINS env var) — same gate the meme moderation queue uses.
// Community meme cards are still managed through the queue in routes/memes.ts.

import store from '../db.ts';
import { RARITIES, SERIES, type Rarity, type SeriesId } from '../catalog.ts';
import { isAdmin } from '../lib/config.ts';
import { sendJSON, err, readBody } from '../lib/http.ts';
import type { Router } from '../lib/router.ts';

const RARITY_IDS = Object.keys(RARITIES) as Rarity[];
const SERIES_IDS = Object.keys(SERIES) as SeriesId[];
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/; // card id: lowercase slug

// Validate the mutable fields shared by create + update. Returns an error
// message string, or null when everything checks out.
function validate(b: any, requireId: boolean): string | null {
  const name = String(b.name || '').trim();
  if (!name) return 'name is required';
  const series = String(b.series || '');
  if (!SERIES_IDS.includes(series as SeriesId)) return 'invalid series';
  const rarity = String(b.rarity || '');
  if (!RARITY_IDS.includes(rarity as Rarity)) return 'invalid rarity';
  if (!String(b.emoji || '').trim()) return 'emoji is required';
  if (!String(b.flavor || '').trim()) return 'flavor is required';
  if (requireId) {
    const id = String(b.id || '').trim().toLowerCase();
    if (!SLUG.test(id)) return 'id must be lowercase letters, numbers, and dashes';
  }
  return null;
}

export function adminRoutes(r: Router): void {
  r.userGet('/api/admin/cards', ({ res, me }) => {
    if (!isAdmin(me)) return err(res, 403, 'admin only');
    sendJSON(res, 200, { cards: store.listCards() });
  });

  r.userPost('/api/admin/cards', async ({ req, res, me }) => {
    if (!isAdmin(me)) return err(res, 403, 'admin only');
    const b = await readBody(req);
    const id = String(b.id || '').trim().toLowerCase();
    const problem = validate({ ...b, id }, true);
    if (problem) return err(res, 400, problem);
    if (store.getCard(id)) return err(res, 409, 'a card with that id already exists');
    const card = store.createCard({
      id,
      name: String(b.name).trim().slice(0, 48),
      series: b.series as SeriesId,
      rarity: b.rarity as Rarity,
      emoji: String(b.emoji).trim().slice(0, 16),
      flavor: String(b.flavor).trim().slice(0, 200),
      image: String(b.image || '').trim() || undefined,
    });
    sendJSON(res, 200, { card });
  });

  r.userPost('/api/admin/cards/:id', async ({ req, res, me, params }) => {
    if (!isAdmin(me)) return err(res, 403, 'admin only');
    if (!store.getCard(params.id!)) return err(res, 404, 'card not found');
    const b = await readBody(req);
    const problem = validate(b, false);
    if (problem) return err(res, 400, problem);
    store.updateCard(params.id!, {
      name: String(b.name).trim().slice(0, 48),
      series: b.series as SeriesId,
      rarity: b.rarity as Rarity,
      emoji: String(b.emoji).trim().slice(0, 16),
      flavor: String(b.flavor).trim().slice(0, 200),
      image: String(b.image || '').trim() || undefined,
    });
    sendJSON(res, 200, { card: store.getCard(params.id!) });
  });

  r.userPost('/api/admin/cards/:id/delete', ({ res, me, params }) => {
    if (!isAdmin(me)) return err(res, 403, 'admin only');
    if (!store.getCard(params.id!)) return err(res, 404, 'card not found');
    store.deleteCard(params.id!); // owned instances fall back to the RETIRED card
    sendJSON(res, 200, { ok: true });
  });
}
