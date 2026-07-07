// Bot swarm members: seeded on startup so trading works out of the box, and
// simple decision logic for how they respond to trade offers. (Bot battle
// play lives in routes/battles.ts, next to the battle flow it drives.)

import store from '../db.ts';
import type { Trade } from '../db.ts';
import { openPackFor, instValue } from './cardpool.ts';

export function seedBots(): void {
  const bots = [
    { name: 'gymbag_enjoyer',  packs: 5 },
    { name: 'buh_collector',   packs: 6 },
    { name: 'tutel_truther',   packs: 4 },
    { name: 'evil_hag_stan',   packs: 5 },
  ];
  for (const b of bots) {
    if (store.getUserByName(b.name)) continue;
    const user = store.createUser({
      name: b.name, bot: true, neuros: 500,
      avatar: `/api/avatar/${encodeURIComponent(b.name)}.svg`,
    });
    for (let i = 0; i < b.packs; i++) openPackFor(user);
  }
}

// Bots respond to trades instantly: accept if the offered value is fair,
// otherwise decline.
export function botConsiderTrade(trade: Trade): Trade {
  const value = (ids: string[]) => ids.reduce((s, id) => {
    const inst = store.getInstance(id);
    return s + (inst ? instValue(inst) : 0);
  }, 0);
  if (value(trade.offer) >= value(trade.request)) store.executeTrade(trade);
  else store.resolveTrade(trade.id, 'declined');
  return store.getTrade(trade.id)!;
}
