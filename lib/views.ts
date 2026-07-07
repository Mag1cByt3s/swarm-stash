// JSON shapes sent to the client — shared serializers for rows that appear
// in many endpoints. Endpoint-specific shapes (tradeOut, battleOut, …) live
// next to their routes.

import store from '../db.ts';
import type { UserRow, InstanceRow } from '../db.ts';

export function publicUser(u: UserRow) {
  const counts = store.userCounts(u.id);
  return {
    id: u.id, name: u.name, avatar: u.avatar, bot: Boolean(u.bot),
    cardCount: counts.cardCount, uniqueCount: counts.uniqueCount,
    joinedAt: u.createdAt,
  };
}

export const instOut = (i: InstanceRow) =>
  ({ instanceId: i.id, cardId: i.cardId, ownerId: i.ownerId, obtainedAt: i.obtainedAt, foil: Boolean(i.foil) });
