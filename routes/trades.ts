// Card-for-card trading between players (and bots, who respond instantly).

import store from '../db.ts';
import type { Trade } from '../db.ts';
import { sendJSON, err, readBody } from '../lib/http.ts';
import { instOut } from '../lib/views.ts';
import { checkAchievements, achOut, tradeExecuted } from '../lib/progress.ts';
import { botConsiderTrade } from '../lib/bots.ts';
import type { Achievement } from '../achievements.ts';
import type { Router } from '../lib/router.ts';

function tradeOut(t: Trade) {
  const resolve = (id: string) => {
    const inst = store.getInstance(id);
    return inst ? instOut(inst) : { instanceId: id, gone: true };
  };
  return { ...t, offer: t.offer.map(resolve), request: t.request.map(resolve) };
}

export function tradeRoutes(r: Router): void {
  r.userGet('/api/trades', ({ res, me }) => {
    const mine = store.listTradesFor(me.id).map(tradeOut);
    const names: Record<string, { name: string; avatar: string }> = {};
    for (const t of mine) {
      for (const id of [t.fromId, t.toId]) {
        if (names[id]) continue;
        const u = store.getUser(id);
        if (u) names[id] = { name: u.name, avatar: u.avatar };
      }
    }
    sendJSON(res, 200, { trades: mine, users: names });
  });

  r.userPost('/api/trades', async ({ req, res, me }) => {
    const { toId, offer = [], request = [], message = '' } = await readBody(req);
    const target = store.getUser(toId);
    if (!target || target.id === me.id) return err(res, 400, 'invalid trade partner');
    if (!offer.length || !request.length) return err(res, 400, 'both sides of the trade need at least one card');
    if (offer.length > 6 || request.length > 6) return err(res, 400, 'max 6 cards per side');
    for (const id of offer) {
      const inst = store.getInstance(id);
      if (!inst || inst.ownerId !== me.id) return err(res, 400, 'you can only offer cards you own');
    }
    for (const id of request) {
      const inst = store.getInstance(id);
      if (!inst || inst.ownerId !== target.id) return err(res, 400, 'requested cards must belong to the trade partner');
    }
    const locked = store.lockedInstanceIds();
    if ([...offer, ...request].some((id) => locked.has(id))) return err(res, 400, 'one of these cards is locked in another pending trade');

    let trade = store.createTrade({
      fromId: me.id, toId: target.id,
      offer: [...new Set(offer as string[])], request: [...new Set(request as string[])],
      message: String(message).slice(0, 200),
    });
    let unlocked: Achievement[] = [];
    if (target.bot) {
      trade = botConsiderTrade(trade);
      if (trade.status === 'accepted') unlocked = tradeExecuted(trade)[me.id]!;
    }
    sendJSON(res, 200, { trade: tradeOut(trade), unlocked: unlocked.map(achOut), neuros: store.getUser(me.id)!.neuros });
  });

  r.userPost('/api/trades/:id/:action', ({ res, me, params }) => {
    const { id, action } = params;
    if (action !== 'accept' && action !== 'decline' && action !== 'cancel') return err(res, 404, 'no such endpoint');
    const t = store.getTrade(id!);
    if (!t) return err(res, 404, 'trade not found');
    if (t.status !== 'pending') return err(res, 400, 'trade already resolved');
    if (action === 'cancel' && t.fromId !== me.id) return err(res, 403, 'only the sender can cancel');
    if ((action === 'accept' || action === 'decline') && t.toId !== me.id) return err(res, 403, 'only the recipient can respond');

    let unlocked: Achievement[] = [];
    if (action === 'accept') {
      // re-validate ownership at accept time
      const owns = (cid: string, uid: string) => { const i = store.getInstance(cid); return i && i.ownerId === uid; };
      const ok = t.offer.every((cid) => owns(cid, t.fromId)) && t.request.every((cid) => owns(cid, t.toId));
      if (!ok) { store.resolveTrade(t.id, 'expired'); return err(res, 409, 'a card in this trade changed hands — trade expired'); }
      store.executeTrade(t);
      unlocked = tradeExecuted(t)[me.id]!;
    } else {
      store.resolveTrade(t.id, action === 'decline' ? 'declined' : 'cancelled');
    }
    sendJSON(res, 200, { trade: tradeOut(store.getTrade(id!)!), unlocked: unlocked.map(achOut), neuros: store.getUser(me.id)!.neuros });
  });
}
