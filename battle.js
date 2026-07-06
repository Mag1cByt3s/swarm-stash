// Swarm Stash — battle engine ("Buh-ttles")
// Pokémon-style turn-based combat: teams of 3, one active fighter each,
// alternating turns. Stats and the special move derive deterministically
// from the card id hash — same trick as meme rarity — so every copy of a
// card fights identically. Foils get +10% on everything.

const crypto = require('node:crypto');

// series advantage cycle: each series hits the next one for 1.3×, and is
// resisted (0.75×) by the previous one. meme closes the loop back to neuro.
const CYCLE = ['neuro', 'evil', 'duo', 'vedal', 'collab', 'meme'];
const nextIn = (s) => CYCLE[(CYCLE.indexOf(s) + 1) % CYCLE.length];
function seriesMult(attacker, defender) {
  if (nextIn(attacker) === defender) return 1.3;
  if (nextIn(defender) === attacker) return 0.75;
  return 1;
}

const RARITY_BONUS = { common: 0, uncommon: 2, rare: 4, epic: 7, legendary: 10 };

const BASIC_NAMES = {
  neuro: 'buh Blast', evil: 'Raspy Cackle', duo: 'Twin Strike',
  vedal: 'Tutel Toss', collab: 'Collab Chaos', meme: 'Meme Slam',
};

// the "perk" — one special move per card, chosen by hash
const SPECIALS = [
  { type: 'heavy', name: 'All In',       desc: 'Big damage, 75% accuracy' },
  { type: 'drain', name: 'Heart Steal',  desc: 'Damage + heal half of it' },
  { type: 'break', name: 'Filter Break', desc: 'Damage + shreds enemy DEF 20%' },
  { type: 'heal',  name: 'Cookie Break', desc: 'No damage, heal 30% max HP' },
];

// Deterministic combat sheet for a card (all copies identical; foil +10%)
function statsFor(card, foil = false) {
  const h = crypto.createHash('sha1').update(card.id).digest();
  const b = RARITY_BONUS[card.rarity] ?? 0;
  const f = foil ? 1.1 : 1;
  return {
    maxHp: Math.round((70 + h[0] % 45 + b * 8) * f),
    atk:   Math.round((22 + h[1] % 18 + b * 4) * f),
    def:   Math.round((16 + h[2] % 14 + b * 3) * f),
    spd:   Math.round((10 + h[3] % 30 + b * 2) * f),
    special: SPECIALS[h[4] % SPECIALS.length],
  };
}

// Battle-state fighter snapshot (stats frozen at battle start)
function fighter(card, foil) {
  const s = statsFor(card, foil);
  return {
    cardId: card.id, name: card.name, series: card.series, rarity: card.rarity,
    emoji: card.emoji || '🖼️', foil: Boolean(foil),
    ...s, hp: s.maxHp, defMod: 1,
    basicName: BASIC_NAMES[card.series] || 'Meme Slam',
  };
}

const alive = (team) => team.filter((f) => f.hp > 0);
const activeF = (state, uid) => state.teams[uid][state.active[uid]];

function log(state, msg) {
  state.log.push(msg);
  if (state.log.length > 60) state.log.shift();
}

// Executes one attack (moveIdx 0 = basic, 1 = special). Mutates state.
// Returns true if the defender's whole team is down.
function attack(state, attackerId, defenderId, moveIdx) {
  const a = activeF(state, attackerId);
  const d = activeF(state, defenderId);
  const special = moveIdx === 1;
  const moveName = special ? a.special.name : a.basicName;

  if (special && a.special.type === 'heal') {
    const heal = Math.round(a.maxHp * 0.3);
    a.hp = Math.min(a.maxHp, a.hp + heal);
    log(state, `${a.name} uses ${moveName} and heals ${heal} HP 🍪`);
    return false;
  }

  const power = special ? (a.special.type === 'heavy' ? 40 : a.special.type === 'drain' ? 18 : 16) : 22;
  if (special && a.special.type === 'heavy' && Math.random() > 0.75) {
    log(state, `${a.name} goes ${moveName}… and whiffs completely 💨`);
    return false;
  }

  const mult = seriesMult(a.series, d.series);
  const dmg = Math.max(1, Math.round(power * (a.atk / Math.max(1, d.def * d.defMod)) * mult * (0.9 + Math.random() * 0.2)));
  d.hp = Math.max(0, d.hp - dmg);
  const eff = mult > 1 ? ' It’s super effective!' : mult < 1 ? ' It’s not very effective…' : '';
  log(state, `${a.name} uses ${moveName} for ${dmg} damage.${eff}`);

  if (special && a.special.type === 'drain') {
    const heal = Math.ceil(dmg / 2);
    a.hp = Math.min(a.maxHp, a.hp + heal);
    log(state, `${a.name} siphons ${heal} HP 🖤`);
  }
  if (special && a.special.type === 'break') {
    d.defMod = Math.max(0.5, d.defMod - 0.2);
    log(state, `${d.name}'s DEF is shredded!`);
  }

  if (d.hp === 0) {
    log(state, `${d.name} is down! 💀`);
    const next = state.teams[defenderId].findIndex((f) => f.hp > 0);
    if (next === -1) return true;
    state.active[defenderId] = next;
    log(state, `${state.teams[defenderId][next].name} steps up!`);
  }
  return false;
}

// Simple bot brain: heal when hurt, mix specials in, otherwise jab.
function botPickMove(state, botId) {
  const me = activeF(state, botId);
  if (me.special.type === 'heal' && me.hp < me.maxHp * 0.45) return 1;
  if (me.special.type === 'heavy' || me.special.type === 'drain' || me.special.type === 'break') {
    return Math.random() < 0.45 ? 1 : 0;
  }
  return 0;
}

module.exports = { statsFor, fighter, attack, botPickMove, seriesMult, alive, activeF, log, SPECIALS };
