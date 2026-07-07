// Achievement engine: evaluates every locked achievement against a user's
// live state, pays out rewards, and reports what was newly unlocked so
// endpoints can surface toasts.

import { ACHIEVEMENTS, type Achievement, type AchievementCtx } from '../achievements.ts';
import store from '../db.ts';
import type { UserRow, InstanceRow, Trade } from '../db.ts';
import { getCard } from './cardpool.ts';

export function checkAchievements(user: UserRow): Achievement[] {
  if (user.bot) return [];
  const fresh = store.getUser(user.id)!;
  const have = new Set(store.listAchievements(user.id).map((a) => a.achId));
  const insts = store.listByOwner(user.id);
  const isLegendary = (i: InstanceRow) => getCard(i.cardId).rarity === 'legendary';
  const ctx: AchievementCtx = {
    stat: (k) => store.getStat(user.id, k),
    ownedIds: new Set(insts.map((i) => i.cardId)),
    hasFoil: insts.some((i) => i.foil),
    hasLegendary: insts.some(isLegendary),
    hasFoilLegendary: insts.some((i) => i.foil && isLegendary(i)),
    neuros: fresh.neuros,
    approvedMemes: store.approvedCountBy(user.id),
    wotwWins: store.wotwWinsBy(user.id),
  };
  const unlocked: Achievement[] = [];
  let neuros = fresh.neuros;
  for (const a of ACHIEVEMENTS) {
    if (have.has(a.id) || !a.check(ctx)) continue;
    store.unlockAchievement(user.id, a.id);
    neuros += a.reward;
    unlocked.push(a);
  }
  if (neuros !== fresh.neuros) store.setNeuros(user.id, neuros);
  return unlocked;
}

// Client-facing shape of an achievement definition (drops the check fn).
export const achOut = ({ id, name, emoji, desc, reward }: Achievement) => ({ id, name, emoji, desc, reward });

// Post-trade bookkeeping for both parties; returns userId → newly unlocked.
export function tradeExecuted(trade: Trade): Record<string, Achievement[]> {
  const unlocked: Record<string, Achievement[]> = {};
  for (const id of [trade.fromId, trade.toId]) {
    store.bumpStat(id, 'trades');
    unlocked[id] = checkAchievements(store.getUser(id)!);
  }
  return unlocked;
}
