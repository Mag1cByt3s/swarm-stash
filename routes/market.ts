// The marketplace: fixed-price listings plus the auction house. Escrow and
// settlement logic for auctions lives in db.ts (placeBid /
// resolveExpiredAuctions); these routes do validation and shaping.

import store from '../db.ts';
import type { AuctionRow } from '../db.ts';
import { sendJSON, err, readBody } from '../lib/http.ts';
import { instOut } from '../lib/views.ts';
import { checkAchievements, achOut } from '../lib/progress.ts';
import type { Router } from '../lib/router.ts';

const MIN_AUCTION_HOURS = 1, MAX_AUCTION_HOURS = 168; // 1 week cap

function auctionOut(a: AuctionRow) {
  return {
    id: a.id, sellerId: a.sellerId, sellerName: a.sellerName, sellerAvatar: a.sellerAvatar,
    startingBid: a.startingBid, currentBid: a.currentBid, bidCount: a.bidCount,
    currentBidderId: a.currentBidderId,
    currentBidderName: a.bidderName || null,
    endsAt: a.endsAt, createdAt: a.createdAt,
    card: instOut(store.getInstance(a.instanceId) || { id: a.instanceId, cardId: 'retired', ownerId: a.sellerId, obtainedAt: a.createdAt, foil: 0 }),
  };
}

export function marketRoutes(r: Router): void {
  // ── auction house (register before /api/market/:id/:action so "auctions"
  //    is never mistaken for a listing id) ──
  r.userGet('/api/market/auctions', ({ res }) => {
    store.resolveExpiredAuctions();
    sendJSON(res, 200, { auctions: store.activeAuctions().map(auctionOut) });
  });

  r.userPost('/api/market/auctions', async ({ req, res, me }) => {
    store.resolveExpiredAuctions();
    const { instanceId, startingBid, durationHours } = await readBody(req);
    const inst = store.getInstance(instanceId);
    if (!inst || inst.ownerId !== me.id) return err(res, 404, 'card not found in your binder');
    if (store.lockedInstanceIds().has(inst.id)) return err(res, 400, 'card is already listed, auctioned, or locked in a trade');
    const bid = Math.floor(Number(startingBid));
    if (!Number.isFinite(bid) || bid < 1 || bid > 100000) return err(res, 400, 'starting bid must be 1–100000 neuros');
    const hours = Math.floor(Number(durationHours));
    if (!Number.isFinite(hours) || hours < MIN_AUCTION_HOURS || hours > MAX_AUCTION_HOURS)
      return err(res, 400, `duration must be ${MIN_AUCTION_HOURS}–${MAX_AUCTION_HOURS} hours`);
    const auction = store.createAuction({ instanceId: inst.id, sellerId: me.id, startingBid: bid, durationHours: hours });
    sendJSON(res, 200, { auction: auctionOut({ ...auction, sellerName: me.name, sellerAvatar: me.avatar, bidCount: 0 }) });
  });

  r.userPost('/api/market/auctions/:id/:action', async ({ req, res, me, params }) => {
    const { id, action } = params;
    if (action !== 'bid' && action !== 'cancel') return err(res, 404, 'no such endpoint');
    store.resolveExpiredAuctions();
    if (action === 'cancel') {
      const a = store.getAuction(id!);
      if (!a || a.status !== 'active') return err(res, 404, 'auction not found');
      if (a.sellerId !== me.id) return err(res, 403, 'not your auction');
      try { store.cancelAuction(id!); }
      catch (e) { return err(res, 400, (e as Error).message); }
      return sendJSON(res, 200, { ok: true });
    }
    const { amount } = await readBody(req);
    const bidAmount = Math.floor(Number(amount));
    if (!Number.isFinite(bidAmount) || bidAmount < 1) return err(res, 400, 'invalid bid amount');
    try {
      store.placeBid(id!, me.id, bidAmount);
    } catch (e) { return err(res, 400, (e as Error).message); }
    sendJSON(res, 200, { ok: true, neuros: store.getUser(me.id)!.neuros, auction: auctionOut(store.activeAuctions().find((a) => a.id === id)!) });
  });

  // ── fixed-price listings ──
  r.userGet('/api/market', ({ res }) => {
    const listings = store.activeListings().flatMap((l) => {
      const inst = store.getInstance(l.instanceId);
      return inst && inst.ownerId === l.sellerId
        ? [{ id: l.id, price: l.price, sellerId: l.sellerId, sellerName: l.sellerName, sellerAvatar: l.sellerAvatar, createdAt: l.createdAt, card: instOut(inst) }]
        : [];
    });
    sendJSON(res, 200, { listings });
  });

  r.userPost('/api/market', async ({ req, res, me }) => {
    const { instanceId, price } = await readBody(req);
    const inst = store.getInstance(String(instanceId || ''));
    if (!inst || inst.ownerId !== me.id) return err(res, 404, 'card not found in your binder');
    if (store.lockedInstanceIds().has(inst.id)) return err(res, 400, 'card is already listed or locked in a trade');
    const pr = Math.floor(Number(price));
    if (!Number.isFinite(pr) || pr < 1 || pr > 100000) return err(res, 400, 'price must be 1–100000 neuros');
    const listing = store.createListing({ instanceId: inst.id, sellerId: me.id, price: pr });
    sendJSON(res, 200, { listing });
  });

  r.userPost('/api/market/:id/:action', ({ res, me, params }) => {
    if (params.action !== 'buy' && params.action !== 'cancel') return err(res, 404, 'no such endpoint');
    const l = store.getListing(params.id!);
    if (!l || l.status !== 'active') return err(res, 404, 'listing not found');
    if (params.action === 'cancel') {
      if (l.sellerId !== me.id) return err(res, 403, 'not your listing');
      store.resolveListing(l.id, 'cancelled');
      return sendJSON(res, 200, { ok: true });
    }
    if (l.sellerId === me.id) return err(res, 400, 'that is your own listing');
    if (me.neuros < l.price) return err(res, 400, `not enough neuros — this card costs ⚡${l.price}`);
    const inst = store.getInstance(l.instanceId);
    if (!inst || inst.ownerId !== l.sellerId) {
      store.resolveListing(l.id, 'cancelled');
      return err(res, 409, 'that card is gone — listing removed');
    }
    const seller = store.getUser(l.sellerId)!;
    store.transferInstance(inst.id, me.id);
    store.setNeuros(me.id, me.neuros - l.price);
    store.setNeuros(seller.id, seller.neuros + l.price);
    store.resolveListing(l.id, 'sold', me.id);
    store.bumpStat(seller.id, 'marketSales');
    checkAchievements(store.getUser(seller.id)!);
    const unlocked = checkAchievements(me);
    sendJSON(res, 200, { ok: true, neuros: store.getUser(me.id)!.neuros, unlocked: unlocked.map(achOut) });
  });
}
