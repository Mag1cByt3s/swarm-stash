// Swarm Stash — achievement definitions
// Each check is a pure function over a ctx snapshot built in server.js.
// Unlocks are permanent (trading a card away later doesn't revoke them).

const { CARDS } = require('./catalog');

const bySeries = {};
for (const c of CARDS) (bySeries[c.series] ||= []).push(c.id);

const setDone = (series) => (ctx) => bySeries[series].every((id) => ctx.ownedIds.has(id));

const ACHIEVEMENTS = [
  { id: 'pack-1',     name: 'Pack Ripper',        emoji: '📦', reward: 50,   desc: 'Open your first pack',            check: (ctx) => ctx.stat('packs') >= 1 },
  { id: 'pack-10',    name: 'Certified Ripper',   emoji: '🃏', reward: 150,  desc: 'Open 10 packs',                   check: (ctx) => ctx.stat('packs') >= 10 },
  { id: 'pack-50',    name: 'Gambling Problem',   emoji: '🎰', reward: 500,  desc: 'Open 50 packs',                   check: (ctx) => ctx.stat('packs') >= 50 },
  { id: 'trade-1',    name: 'First Deal',         emoji: '🤝', reward: 50,   desc: 'Complete a trade',                check: (ctx) => ctx.stat('trades') >= 1 },
  { id: 'trade-10',   name: 'Market Menace',      emoji: '💼', reward: 200,  desc: 'Complete 10 trades',              check: (ctx) => ctx.stat('trades') >= 10 },
  { id: 'recycle-10', name: 'Loves the Planet',   emoji: '♻️', reward: 75,   desc: 'Recycle 10 cards',                check: (ctx) => ctx.stat('recycled') >= 10 },
  { id: 'legendary',  name: 'Star Struck',        emoji: '🌟', reward: 100,  desc: 'Own a legendary card',            check: (ctx) => ctx.hasLegendary },
  { id: 'foil-1',     name: 'Shiny Hunter',       emoji: '✨', reward: 75,   desc: 'Own a foil card',                 check: (ctx) => ctx.hasFoil },
  { id: 'foil-leg',   name: 'The Holo Grail',     emoji: '🏆', reward: 500,  desc: 'Own a foil legendary',            check: (ctx) => ctx.hasFoilLegendary },
  { id: 'meme-lord',  name: 'Meme Lord',          emoji: '🖼️', reward: 100,  desc: 'Get a meme approved as a card',   check: (ctx) => ctx.approvedMemes >= 1 },
  { id: 'battle-1',   name: 'Buh-tality',         emoji: '⚔️', reward: 100,  desc: 'Win your first battle',           check: (ctx) => ctx.stat('battleWins') >= 1 },
  { id: 'battle-10',  name: 'Arena Menace',       emoji: '🏟️', reward: 400,  desc: 'Win 10 battles',                  check: (ctx) => ctx.stat('battleWins') >= 10 },
  { id: 'merchant',   name: 'Entrepreneur',       emoji: '💰', reward: 50,   desc: 'Sell a card on the market',       check: (ctx) => ctx.stat('marketSales') >= 1 },
  { id: 'wotw',       name: 'Meme of the Week',   emoji: '🗳️', reward: 200,  desc: 'Win the weekly meme vote',        check: (ctx) => ctx.wotwWins >= 1 },
  { id: 'rich',       name: 'Neuro Hoarder',     emoji: '⚡', reward: 0,    desc: 'Hold 1,000 neuros at once',      check: (ctx) => ctx.neuros >= 1000 },
  { id: 'set-neuro',  name: 'Heart of the Swarm', emoji: '💗', reward: 600,  desc: 'Complete the Neuro-sama series',  check: setDone('neuro') },
  { id: 'set-evil',   name: 'Certified Evil',     emoji: '😈', reward: 400,  desc: 'Complete the Evil Neuro series',  check: setDone('evil') },
  { id: 'set-duo',    name: 'Double Trouble',     emoji: '👯', reward: 300,  desc: 'Complete The Twins series',       check: setDone('duo') },
  { id: 'set-vedal',  name: 'Turtle Council',     emoji: '🐢', reward: 350,  desc: 'Complete the Vedal series',       check: setDone('vedal') },
  { id: 'set-collab', name: 'Collab Enjoyer',     emoji: '🎪', reward: 250,  desc: 'Complete the Collabs series',     check: setDone('collab') },
  { id: 'all-cards',  name: 'Grand Archivist',    emoji: '📚', reward: 2000, desc: 'Complete every lore series',      check: (ctx) => CARDS.every((c) => ctx.ownedIds.has(c.id)) },
];

module.exports = { ACHIEVEMENTS };
