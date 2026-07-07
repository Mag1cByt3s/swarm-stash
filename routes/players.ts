// Player-facing profile & community endpoints: who am I, member list,
// leaderboard, public binders, achievements, and the showcase pins.

import store from '../db.ts';
import { isAdmin } from '../lib/config.ts';
import { ACHIEVEMENTS } from '../achievements.ts';
import { sendJSON, err, readBody } from '../lib/http.ts';
import { instValue } from '../lib/cardpool.ts';
import { publicUser, instOut } from '../lib/views.ts';
import { achOut } from '../lib/progress.ts';
import type { Router } from '../lib/router.ts';

export function playerRoutes(r: Router): void {
  r.get('/api/me', ({ res, me }) => {
    if (!me) return sendJSON(res, 200, { user: null });
    sendJSON(res, 200, { user: {
      ...publicUser(me), neuros: me.neuros,
      dailyReady: Date.now() - me.lastDaily > 20 * 3600e3,
      isAdmin: isAdmin(me),
      modPending: isAdmin(me) ? store.pendingCount() : 0,
    } });
  });

  r.get('/api/users', ({ res }) => {
    const users = store.listUsers().map(publicUser).sort((a, b) => b.cardCount - a.cardCount);
    sendJSON(res, 200, { users });
  });

  r.get('/api/leaderboard', ({ res }) => {
    // binder value (foils count ×FOIL_MULT) + 100 clout per achievement; bots don't rank
    const board = store.listUsers().filter((u) => !u.bot).map((u) => {
      const insts = store.listByOwner(u.id);
      const value = insts.reduce((s, i) => s + instValue(i), 0);
      const achievements = store.listAchievements(u.id).length;
      return {
        id: u.id, name: u.name, avatar: u.avatar,
        cards: insts.length, unique: new Set(insts.map((i) => i.cardId)).size,
        foils: insts.filter((i) => i.foil).length,
        achievements, score: value + achievements * 100,
      };
    }).sort((a, b) => b.score - a.score);
    sendJSON(res, 200, { board });
  });

  r.get('/api/collection', ({ res, url, me }) => {
    const targetId = url.searchParams.get('user') || me?.id;
    const target = targetId ? store.getUser(targetId) : undefined;
    if (!target) return err(res, 404, 'user not found');
    const cards = store.listByOwner(target.id).map(instOut);
    const showcase = (JSON.parse(target.showcase || '[]') as string[]).filter((id) => {
      const inst = store.getInstance(id);
      return inst && inst.ownerId === target.id; // drop pins for cards that changed hands
    });
    sendJSON(res, 200, { user: publicUser(target), cards, showcase });
  });

  r.userGet('/api/achievements', ({ res, me }) => {
    const unlocked = Object.fromEntries(store.listAchievements(me.id).map((a) => [a.achId, a.unlockedAt]));
    sendJSON(res, 200, { defs: ACHIEVEMENTS.map(achOut), unlocked });
  });

  // showcase: pinned cards on your public binder
  r.userPost('/api/showcase', async ({ req, res, me }) => {
    const { instanceIds } = await readBody(req);
    if (!Array.isArray(instanceIds)) return err(res, 400, 'instanceIds required');
    const clean = [...new Set(instanceIds as string[])].slice(0, 6);
    for (const id of clean) {
      const inst = store.getInstance(id);
      if (!inst || inst.ownerId !== me.id) return err(res, 400, 'you can only pin cards you own');
    }
    store.setShowcase(me.id, clean);
    sendJSON(res, 200, { ok: true, showcase: clean });
  });
}
