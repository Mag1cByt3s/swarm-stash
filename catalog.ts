// Swarm Stash — card catalog config: types, rarity/series tables, and the
// gameplay constants. The actual card *entries* live in the database now —
// seeded on startup from lib/seed-cards.ts and editable via the admin page.

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
export type SeriesId = 'neuro' | 'evil' | 'duo' | 'vedal' | 'collab' | 'meme';

export interface Card {
  id: string;
  name: string;
  series: SeriesId;
  rarity: Rarity;
  emoji: string;
  flavor: string;
  image?: string; // set for community meme cards
}

export const RARITIES: Record<Rarity, { weight: number; value: number; label: string }> = {
  common:    { weight: 54,  value: 10,  label: 'Common' },
  uncommon:  { weight: 26,  value: 20,  label: 'Uncommon' },
  rare:      { weight: 13,  value: 50,  label: 'Rare' },
  epic:      { weight: 5.5, value: 125, label: 'Epic' },
  legendary: { weight: 1.5, value: 500, label: 'Legendary' },
};

export const SERIES: Record<SeriesId, { label: string; hue: number; hue2: number }> = {
  meme:   { label: 'Swarm Memes', hue: 210, hue2: 45 },
  neuro:  { label: 'Neuro-sama', hue: 330, hue2: 195 },
  evil:   { label: 'Evil Neuro', hue: 355, hue2: 265 },
  duo:    { label: 'The Twins',  hue: 285, hue2: 330 },
  vedal:  { label: 'Vedal',      hue: 150, hue2: 195 },
  collab: { label: 'Collabs',    hue: 45,  hue2: 330 },
};

export const PACK_COST = 100;
export const PACK_SIZE = 4;
export const DAILY_NEUROS = 150;
export const STARTING_NEUROS = 350;
export const STARTER_CARDS: string[] = ['cookie-gremlin', 'softest-threat', 'alright'];
export const FOIL_CHANCE = 0.05; // per pulled card
export const FOIL_MULT = 4;      // recycle / trade value multiplier for foils
