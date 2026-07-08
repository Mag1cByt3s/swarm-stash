// The live card pool and pack mechanics. The pool is the built-in lore set
// (read from the `cards` table) plus every approved community meme, so it
// changes at runtime as admins edit cards and memes get approved.

import crypto from 'node:crypto';
import {
  RARITIES, PACK_SIZE, FOIL_CHANCE, FOIL_MULT, type Card, type Rarity,
} from '../catalog.ts';
import store from '../db.ts';
import type { UserRow, InstanceRow, MemeRow } from '../db.ts';

// Stand-in for instances whose card no longer exists (e.g. rejected meme).
export const RETIRED: Card = { id: 'retired', name: 'Retired Card', series: 'meme', rarity: 'common', emoji: '❓', flavor: 'Lost to the archives.' };

export const memeToCard = (m: MemeRow): Card => ({
  id: m.id, name: m.name, series: 'meme', rarity: m.rarity,
  emoji: '🖼️', flavor: m.flavor || `submitted by ${m.submitterName}`,
  image: `/memes/${m.file}`,
});

export const allCards = (): Card[] => store.listCards().concat(store.memesByStatus('approved').map(memeToCard));
export const getCard = (id: string): Card => allCards().find((c) => c.id === id) || RETIRED;

// deterministic rarity from the image hash, matching normal pack odds
export function rarityFromHash(seed: string): Rarity {
  const total = Object.values(RARITIES).reduce((s, r) => s + r.weight, 0);
  let roll = (crypto.createHash('sha1').update(seed).digest().readUInt32BE(0) / 0xffffffff) * total;
  for (const [name, r] of Object.entries(RARITIES)) {
    roll -= r.weight;
    if (roll <= 0) return name as Rarity;
  }
  return 'common';
}

export function rollCard(): Card {
  const cards = allCards();
  const total = Object.values(RARITIES).reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  let rarity: Rarity = 'common';
  for (const [name, r] of Object.entries(RARITIES)) {
    roll -= r.weight;
    if (roll <= 0) { rarity = name as Rarity; break; }
  }
  const pool = cards.filter((c) => c.rarity === rarity);
  return pool[Math.floor(Math.random() * pool.length)]!;
}

export function openPackFor(user: UserRow): InstanceRow[] {
  const cards: Card[] = [];
  for (let i = 0; i < PACK_SIZE; i++) cards.push(rollCard());
  // pity: guarantee at least one uncommon or better per pack
  if (cards.every((c) => c.rarity === 'common')) {
    const pool = allCards().filter((c) => c.rarity !== 'common');
    cards[Math.floor(Math.random() * cards.length)] = pool[Math.floor(Math.random() * pool.length)]!;
  }
  return cards.map((c) => store.grantCard(user.id, c.id, Math.random() < FOIL_CHANCE));
}

// Recycle/trade value of one owned card instance.
export const instValue = (inst: InstanceRow): number =>
  RARITIES[getCard(inst.cardId).rarity].value * (inst.foil ? FOIL_MULT : 1);
