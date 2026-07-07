// The neuro economy: daily claim, opening packs, and recycling cards.

import store from '../db.ts';
import { PACK_COST, DAILY_NEUROS } from '../catalog.ts';
import { sendJSON, err } from '../lib/http.ts';
import { openPackFor, instValue } from '../lib/cardpool.ts';
import { instOut } from '../lib/views.ts';
import { checkAchievements, achOut } from '../lib/progress.ts';
import type { Router } from '../lib/router.ts';

export function economyRoutes(r: Router): void {
  r.userPost('/api/daily', ({ res, me }) => {
    if (Date.now() - me.lastDaily < 20 * 3600e3) return err(res, 429, 'Daily neuros already claimed. Come back later!');
    store.claimDaily(me.id, me.neuros + DAILY_NEUROS, Date.now());
    const unlocked = checkAchievements(me);
    sendJSON(res, 200, { neuros: store.getUser(me.id)!.neuros, gained: DAILY_NEUROS, unlocked: unlocked.map(achOut) });
  });

  r.userPost('/api/packs/open', ({ res, me }) => {
    if (me.neuros < PACK_COST) return err(res, 400, `Not enough neuros — a pack costs ${PACK_COST}.`);
    store.setNeuros(me.id, me.neuros - PACK_COST);
    store.bumpStat(me.id, 'packs');
    const pulls = openPackFor(me);
    const unlocked = checkAchievements(me);
    sendJSON(res, 200, { neuros: store.getUser(me.id)!.neuros, cards: pulls.map(instOut), unlocked: unlocked.map(achOut) });
  });

  r.userPost('/api/cards/:id/sell', ({ res, me, params }) => {
    const inst = store.getInstance(params.id!);
    if (!inst || inst.ownerId !== me.id) return err(res, 404, 'card not found in your binder');
    if (store.lockedInstanceIds().has(inst.id)) return err(res, 400, 'card is locked in a pending trade or market listing');
    const value = instValue(inst);
    store.deleteInstance(inst.id);
    store.setNeuros(me.id, me.neuros + value);
    store.bumpStat(me.id, 'recycled');
    const unlocked = checkAchievements(me);
    sendJSON(res, 200, { neuros: store.getUser(me.id)!.neuros, gained: value, unlocked: unlocked.map(achOut) });
  });
}
