// Arena battles: challenges, team building, turn handling, wager escrow, and
// the instant-play bot opponent logic. Combat math itself lives in battle.ts.

import store from '../db.ts';
import type { UserRow, Battle } from '../db.ts';
import * as battle from '../battle.ts';
import type { Fighter } from '../battle.ts';
import { sendJSON, err, readBody } from '../lib/http.ts';
import { getCard, instValue } from '../lib/cardpool.ts';
import { checkAchievements, achOut } from '../lib/progress.ts';
import type { Achievement } from '../achievements.ts';
import type { Router } from '../lib/router.ts';

const MAX_WAGER = 1000;

// 3 distinct owned instances → fighter snapshots (stats frozen at this moment)
function buildTeam(user: UserRow, ids: unknown): Fighter[] | null {
  if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3) return null;
  const team: Fighter[] = [];
  for (const id of ids as string[]) {
    const inst = store.getInstance(id);
    if (!inst || inst.ownerId !== user.id) return null;
    team.push(battle.fighter(getCard(inst.cardId), Boolean(inst.foil)));
  }
  return team;
}

// Bots field their 3 most valuable cards (distinct cards where possible)
function botTeamIds(bot: UserRow): string[] | null {
  const insts = store.listByOwner(bot.id).sort((a, b) => instValue(b) - instValue(a));
  const picked: string[] = [];
  const seen = new Set<string>();
  for (const i of insts) {
    if (seen.has(i.cardId)) continue;
    seen.add(i.cardId);
    picked.push(i.id);
    if (picked.length === 3) return picked;
  }
  for (const i of insts) { // not enough distinct cards — allow duplicates
    if (!picked.includes(i.id)) picked.push(i.id);
    if (picked.length === 3) return picked;
  }
  return null;
}

function activateBattle(b: Battle, opponentTeam: Fighter[]): void {
  b.state.teams[b.toId] = opponentTeam;
  b.status = 'active';
  // faster opening fighter moves first; challenger wins speed ties
  const from = b.state.teams[b.fromId]![0]!, to = opponentTeam[0]!;
  const first = to.spd > from.spd ? b.toId : b.fromId;
  b.state.turn = first;
  battle.log(b.state, `⚔️ Battle start! ${battle.activeF(b.state, first).name} is faster and moves first.`);
}

function finishBattle(b: Battle, winnerId: string): Record<string, Achievement[]> {
  b.status = 'done';
  b.winnerId = winnerId;
  b.state.turn = null;
  battle.log(b.state, `🏆 ${store.getUser(winnerId)!.name} wins the battle!`);
  if (b.wager > 0) {
    const w = store.getUser(winnerId)!;
    store.setNeuros(winnerId, w.neuros + b.wager * 2);
    battle.log(b.state, `⚡${b.wager * 2} pot goes to the winner.`);
  }
  store.bumpStat(winnerId, 'battleWins');
  const unlocked: Record<string, Achievement[]> = {};
  for (const id of [b.fromId, b.toId]) unlocked[id] = checkAchievements(store.getUser(id)!);
  return unlocked;
}

// Bots take their turns immediately; returns finish unlocks if the bot won.
function runBotTurns(b: Battle): Record<string, Achievement[]> | null {
  let guard = 0;
  while (b.status === 'active' && guard++ < 50) {
    if (!b.state.turn) break;
    const turnUser = store.getUser(b.state.turn);
    if (!turnUser || !turnUser.bot) break;
    const oppId = b.state.turn === b.fromId ? b.toId : b.fromId;
    const wiped = battle.attack(b.state, turnUser.id, oppId, battle.botPickMove(b.state, turnUser.id));
    if (wiped) return finishBattle(b, turnUser.id);
    b.state.turn = oppId;
  }
  return null;
}

const battleOut = (b: Battle) => ({
  id: b.id, fromId: b.fromId, toId: b.toId, wager: b.wager,
  status: b.status, winnerId: b.winnerId, state: b.state,
  createdAt: b.createdAt, updatedAt: b.updatedAt,
});

export function battleRoutes(r: Router): void {
  r.userGet('/api/battles', ({ res, me }) => {
    const mine = store.listBattlesFor(me.id).map(battleOut);
    const names: Record<string, { name: string; avatar: string; bot: boolean }> = {};
    for (const b of mine) {
      for (const id of [b.fromId, b.toId]) {
        if (names[id]) continue;
        const u = store.getUser(id);
        if (u) names[id] = { name: u.name, avatar: u.avatar, bot: Boolean(u.bot) };
      }
    }
    sendJSON(res, 200, { battles: mine, users: names });
  });

  r.userPost('/api/battles', async ({ req, res, me }) => {
    const { toId, team, wager = 0 } = await readBody(req);
    const target = store.getUser(toId);
    if (!target || target.id === me.id) return err(res, 400, 'invalid opponent');
    const w = Math.floor(Number(wager)) || 0;
    if (w < 0 || w > MAX_WAGER) return err(res, 400, `wager must be 0–${MAX_WAGER} neuros`);
    if (me.neuros < w) return err(res, 400, 'you cannot stake neuros you do not have');
    const myTeam = buildTeam(me, team);
    if (!myTeam) return err(res, 400, 'pick exactly 3 different cards you own');

    const b = store.createBattle({
      fromId: me.id, toId: target.id, wager: w, status: 'pending',
      state: {
        teams: { [me.id]: myTeam, [target.id]: null },
        active: { [me.id]: 0, [target.id]: 0 },
        turn: null,
        log: [`${me.name} challenges ${target.name}${w ? ` for ⚡${w}` : ''}!`],
      },
    });

    let unlocked: Achievement[] = [];
    if (target.bot) {
      const botIds = botTeamIds(target);
      if (!botIds || target.neuros < w) {
        b.status = 'declined';
        battle.log(b.state, `${target.name} ducks out of the challenge. 🐔`);
      } else {
        store.setNeuros(me.id, me.neuros - w);
        store.setNeuros(target.id, target.neuros - w);
        activateBattle(b, buildTeam(target, botIds)!);
        const finished = runBotTurns(b);
        if (finished) unlocked = finished[me.id]!;
      }
      store.saveBattle(b);
    }
    sendJSON(res, 200, { battle: battleOut(b), unlocked: unlocked.map(achOut), neuros: store.getUser(me.id)!.neuros });
  });

  r.userGet('/api/battles/:id', ({ res, me, params }) => {
    const b = store.getBattle(params.id!);
    if (!b || (b.fromId !== me.id && b.toId !== me.id)) return err(res, 404, 'battle not found');
    const names: Record<string, { name: string; avatar: string; bot: boolean }> = {};
    for (const id of [b.fromId, b.toId]) {
      const u = store.getUser(id);
      if (u) names[id] = { name: u.name, avatar: u.avatar, bot: Boolean(u.bot) };
    }
    sendJSON(res, 200, { battle: battleOut(b), users: names });
  });

  r.userPost('/api/battles/:id/:action', async ({ req, res, me, params }) => {
    const { id, action } = params;
    if (action !== 'accept' && action !== 'decline' && action !== 'cancel' && action !== 'move')
      return err(res, 404, 'no such endpoint');
    const b = store.getBattle(id!);
    if (!b || (b.fromId !== me.id && b.toId !== me.id)) return err(res, 404, 'battle not found');
    let unlocked: Achievement[] = [];

    if (action === 'accept' || action === 'decline') {
      if (b.status !== 'pending') return err(res, 400, 'battle already started or resolved');
      if (b.toId !== me.id) return err(res, 403, 'only the challenged player can respond');
      if (action === 'decline') {
        b.status = 'declined';
      } else {
        const { team } = await readBody(req);
        const myTeam = buildTeam(me, team);
        if (!myTeam) return err(res, 400, 'pick exactly 3 different cards you own');
        if (me.neuros < b.wager) return err(res, 400, `you need ⚡${b.wager} to match the wager`);
        const challenger = store.getUser(b.fromId)!;
        if (challenger.neuros < b.wager) {
          b.status = 'cancelled';
          battle.log(b.state, 'Challenge fizzled — the challenger spent their stake.');
          store.saveBattle(b);
          return err(res, 409, 'the challenger no longer has the wagered neuros');
        }
        store.setNeuros(me.id, me.neuros - b.wager);
        store.setNeuros(challenger.id, challenger.neuros - b.wager);
        activateBattle(b, myTeam);
      }
    } else if (action === 'cancel') {
      if (b.status !== 'pending') return err(res, 400, 'battle already started or resolved');
      if (b.fromId !== me.id) return err(res, 403, 'only the challenger can cancel');
      b.status = 'cancelled';
    } else { // move
      if (b.status !== 'active') return err(res, 400, 'battle is not active');
      const body = await readBody(req);
      const oppId = me.id === b.fromId ? b.toId : b.fromId;
      if (body.type === 'forfeit') {
        battle.log(b.state, `${me.name} forfeits. 🏳️`);
        unlocked = finishBattle(b, oppId)[me.id]!;
      } else {
        if (b.state.turn !== me.id) return err(res, 400, 'not your turn');
        if (body.type === 'swap') {
          const idx = Number(body.index);
          const team = b.state.teams[me.id];
          if (!team || !Number.isInteger(idx) || !team[idx] || team[idx].hp <= 0 || idx === b.state.active[me.id])
            return err(res, 400, 'invalid swap');
          b.state.active[me.id] = idx;
          battle.log(b.state, `${me.name} swaps in ${team[idx].name}!`);
          b.state.turn = oppId;
        } else if (body.type === 'attack') {
          const moveIdx = body.move === 1 ? 1 : 0;
          const wiped = battle.attack(b.state, me.id, oppId, moveIdx);
          if (wiped) unlocked = finishBattle(b, me.id)[me.id]!;
          else b.state.turn = oppId;
        } else {
          return err(res, 400, 'unknown move');
        }
        if (b.status === 'active') {
          const finished = runBotTurns(b);
          if (finished) unlocked = finished[me.id]!;
        }
      }
    }
    store.saveBattle(b);
    sendJSON(res, 200, { battle: battleOut(b), unlocked: unlocked.map(achOut), neuros: store.getUser(me.id)!.neuros });
  });
}
