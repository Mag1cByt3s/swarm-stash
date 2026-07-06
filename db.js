// SQLite storage layer (node:sqlite — built into Node ≥22.13, zero dependencies).
// Migrates a legacy data/db.json automatically on first run.

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { CARDS } = require('./catalog');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'swarm.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id        TEXT PRIMARY KEY,
    discordId TEXT UNIQUE,
    name      TEXT NOT NULL,
    avatar    TEXT NOT NULL,
    bot       INTEGER NOT NULL DEFAULT 0,
    neurons   INTEGER NOT NULL DEFAULT 0,
    lastDaily INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS inventory (
    id         TEXT PRIMARY KEY,
    cardId     TEXT NOT NULL,
    ownerId    TEXT NOT NULL REFERENCES users(id),
    obtainedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_inventory_owner ON inventory(ownerId);

  CREATE TABLE IF NOT EXISTS trades (
    id         TEXT PRIMARY KEY,
    fromId     TEXT NOT NULL REFERENCES users(id),
    toId       TEXT NOT NULL REFERENCES users(id),
    offer      TEXT NOT NULL,   -- JSON array of instance ids
    request    TEXT NOT NULL,   -- JSON array of instance ids
    message    TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'pending',
    createdAt  INTEGER NOT NULL,
    resolvedAt INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_trades_users ON trades(fromId, toId);

  CREATE TABLE IF NOT EXISTS memes (
    id          TEXT PRIMARY KEY,   -- 'm_' + content hash, so re-uploads dedupe
    name        TEXT NOT NULL,
    file        TEXT NOT NULL,
    rarity      TEXT NOT NULL,
    submitterId TEXT NOT NULL REFERENCES users(id),
    status      TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
    createdAt   INTEGER NOT NULL,
    resolvedAt  INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_memes_status ON memes(status);

  CREATE TABLE IF NOT EXISTS achievements (
    userId     TEXT NOT NULL REFERENCES users(id),
    achId      TEXT NOT NULL,
    unlockedAt INTEGER NOT NULL,
    PRIMARY KEY (userId, achId)
  );

  CREATE TABLE IF NOT EXISTS stats (
    userId TEXT NOT NULL REFERENCES users(id),
    key    TEXT NOT NULL,
    value  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (userId, key)
  );

  CREATE TABLE IF NOT EXISTS battles (
    id        TEXT PRIMARY KEY,
    fromId    TEXT NOT NULL REFERENCES users(id),
    toId      TEXT NOT NULL REFERENCES users(id),
    wager     INTEGER NOT NULL DEFAULT 0,
    status    TEXT NOT NULL DEFAULT 'pending',  -- pending | active | done | declined | cancelled
    state     TEXT NOT NULL,                    -- JSON: teams, active, turn, log
    winnerId  TEXT,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_battles_users ON battles(fromId, toId);

  CREATE TABLE IF NOT EXISTS listings (
    id         TEXT PRIMARY KEY,
    instanceId TEXT NOT NULL,
    sellerId   TEXT NOT NULL REFERENCES users(id),
    price      INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active',  -- active | sold | cancelled
    buyerId    TEXT,
    createdAt  INTEGER NOT NULL,
    resolvedAt INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);

  CREATE TABLE IF NOT EXISTS votes (
    week    TEXT NOT NULL,
    voterId TEXT NOT NULL REFERENCES users(id),
    memeId  TEXT NOT NULL REFERENCES memes(id),
    votedAt INTEGER NOT NULL,
    PRIMARY KEY (week, voterId)
  );

  CREATE TABLE IF NOT EXISTS weekly_winners (
    week        TEXT PRIMARY KEY,
    memeId      TEXT NOT NULL,
    submitterId TEXT NOT NULL,
    decidedAt   INTEGER NOT NULL
  );
`);

// foil variants were added after launch — patch older databases in place
try { db.exec(`ALTER TABLE inventory ADD COLUMN foil INTEGER NOT NULL DEFAULT 0`); } catch { /* column exists */ }
// showcase (pinned cards) came even later
try { db.exec(`ALTER TABLE users ADD COLUMN showcase TEXT NOT NULL DEFAULT '[]'`); } catch { /* column exists */ }

const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

// ─── prepared statements ─────────────────────────────────────────────────────
const q = {
  insertUser: db.prepare(`INSERT INTO users (id, discordId, name, avatar, bot, neurons, lastDaily, createdAt)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getUser: db.prepare(`SELECT * FROM users WHERE id = ?`),
  getUserByDiscord: db.prepare(`SELECT * FROM users WHERE discordId = ?`),
  getDevUserByName: db.prepare(`SELECT * FROM users WHERE discordId IS NULL AND bot = 0 AND lower(name) = lower(?)`),
  getUserByName: db.prepare(`SELECT * FROM users WHERE name = ?`),
  listUsers: db.prepare(`SELECT * FROM users`),
  setProfile: db.prepare(`UPDATE users SET name = ?, avatar = ? WHERE id = ?`),
  setNeurons: db.prepare(`UPDATE users SET neurons = ? WHERE id = ?`),
  setDaily: db.prepare(`UPDATE users SET neurons = ?, lastDaily = ? WHERE id = ?`),
  userCounts: db.prepare(`SELECT COUNT(*) AS cardCount, COUNT(DISTINCT cardId) AS uniqueCount FROM inventory WHERE ownerId = ?`),

  insertInstance: db.prepare(`INSERT INTO inventory (id, cardId, ownerId, obtainedAt, foil) VALUES (?, ?, ?, ?, ?)`),
  getInstance: db.prepare(`SELECT * FROM inventory WHERE id = ?`),
  listByOwner: db.prepare(`SELECT * FROM inventory WHERE ownerId = ? ORDER BY obtainedAt DESC`),
  setOwner: db.prepare(`UPDATE inventory SET ownerId = ? WHERE id = ?`),
  deleteInstance: db.prepare(`DELETE FROM inventory WHERE id = ?`),

  insertTrade: db.prepare(`INSERT INTO trades (id, fromId, toId, offer, request, message, status, createdAt)
                           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`),
  getTrade: db.prepare(`SELECT * FROM trades WHERE id = ?`),
  listTradesFor: db.prepare(`SELECT * FROM trades WHERE fromId = ? OR toId = ? ORDER BY createdAt DESC`),
  resolveTrade: db.prepare(`UPDATE trades SET status = ?, resolvedAt = ? WHERE id = ?`),
  pendingTrades: db.prepare(`SELECT offer, request FROM trades WHERE status = 'pending'`),

  insertMeme: db.prepare(`INSERT INTO memes (id, name, file, rarity, submitterId, status, createdAt)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`),
  getMeme: db.prepare(`SELECT * FROM memes WHERE id = ?`),
  memesByStatus: db.prepare(`SELECT m.*, u.name AS submitterName, u.avatar AS submitterAvatar
                             FROM memes m JOIN users u ON u.id = m.submitterId
                             WHERE m.status = ? ORDER BY m.createdAt DESC`),
  memesBySubmitter: db.prepare(`SELECT * FROM memes WHERE submitterId = ? ORDER BY createdAt DESC`),
  resolveMeme: db.prepare(`UPDATE memes SET status = ?, resolvedAt = ? WHERE id = ?`),
  countPendingBy: db.prepare(`SELECT COUNT(*) AS n FROM memes WHERE submitterId = ? AND status = 'pending'`),
  countPending: db.prepare(`SELECT COUNT(*) AS n FROM memes WHERE status = 'pending'`),
  countApprovedBy: db.prepare(`SELECT COUNT(*) AS n FROM memes WHERE submitterId = ? AND status = 'approved'`),

  insertBattle: db.prepare(`INSERT INTO battles (id, fromId, toId, wager, status, state, createdAt, updatedAt)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getBattle: db.prepare(`SELECT * FROM battles WHERE id = ?`),
  listBattlesFor: db.prepare(`SELECT * FROM battles WHERE fromId = ? OR toId = ? ORDER BY createdAt DESC LIMIT 50`),
  updateBattle: db.prepare(`UPDATE battles SET status = ?, state = ?, winnerId = ?, updatedAt = ? WHERE id = ?`),

  insertListing: db.prepare(`INSERT INTO listings (id, instanceId, sellerId, price, status, createdAt)
                             VALUES (?, ?, ?, ?, 'active', ?)`),
  getListing: db.prepare(`SELECT * FROM listings WHERE id = ?`),
  activeListings: db.prepare(`SELECT l.*, u.name AS sellerName, u.avatar AS sellerAvatar
                              FROM listings l JOIN users u ON u.id = l.sellerId
                              WHERE l.status = 'active' ORDER BY l.createdAt DESC`),
  activeListingIds: db.prepare(`SELECT instanceId FROM listings WHERE status = 'active'`),
  resolveListing: db.prepare(`UPDATE listings SET status = ?, buyerId = ?, resolvedAt = ? WHERE id = ?`),

  setShowcase: db.prepare(`UPDATE users SET showcase = ? WHERE id = ?`),

  upsertVote: db.prepare(`INSERT INTO votes (week, voterId, memeId, votedAt) VALUES (?, ?, ?, ?)
                          ON CONFLICT(week, voterId) DO UPDATE SET memeId = excluded.memeId, votedAt = excluded.votedAt`),
  votesForWeek: db.prepare(`SELECT memeId, COUNT(*) AS n FROM votes WHERE week = ? GROUP BY memeId ORDER BY n DESC`),
  myVote: db.prepare(`SELECT memeId FROM votes WHERE week = ? AND voterId = ?`),
  getWinner: db.prepare(`SELECT * FROM weekly_winners WHERE week = ?`),
  latestWinner: db.prepare(`SELECT * FROM weekly_winners ORDER BY decidedAt DESC LIMIT 1`),
  insertWinner: db.prepare(`INSERT OR IGNORE INTO weekly_winners (week, memeId, submitterId, decidedAt) VALUES (?, ?, ?, ?)`),
  wotwWinsBy: db.prepare(`SELECT COUNT(*) AS n FROM weekly_winners WHERE submitterId = ?`),
  setMemeRarity: db.prepare(`UPDATE memes SET rarity = ? WHERE id = ?`),

  unlockAch: db.prepare(`INSERT OR IGNORE INTO achievements (userId, achId, unlockedAt) VALUES (?, ?, ?)`),
  listAch: db.prepare(`SELECT achId, unlockedAt FROM achievements WHERE userId = ?`),
  bumpStat: db.prepare(`INSERT INTO stats (userId, key, value) VALUES (?, ?, ?)
                        ON CONFLICT(userId, key) DO UPDATE SET value = value + excluded.value`),
  getStat: db.prepare(`SELECT value FROM stats WHERE userId = ? AND key = ?`),
};

const rowToTrade = (r) => r && { ...r, offer: JSON.parse(r.offer), request: JSON.parse(r.request) };
const rowToBattle = (r) => r && { ...r, state: JSON.parse(r.state) };

// ─── public API ──────────────────────────────────────────────────────────────
const store = {
  newId,

  createUser({ discordId = null, name, avatar, bot = false, neurons = 0 }) {
    const user = { id: newId('u'), discordId, name, avatar, bot: bot ? 1 : 0, neurons, lastDaily: 0, createdAt: Date.now() };
    q.insertUser.run(user.id, user.discordId, user.name, user.avatar, user.bot, user.neurons, user.lastDaily, user.createdAt);
    return user;
  },
  getUser: (id) => q.getUser.get(id),
  getUserByDiscord: (discordId) => q.getUserByDiscord.get(discordId),
  getDevUserByName: (name) => q.getDevUserByName.get(name),
  getUserByName: (name) => q.getUserByName.get(name),
  listUsers: () => q.listUsers.all(),
  setProfile: (id, name, avatar) => q.setProfile.run(name, avatar, id),
  setNeurons: (id, neurons) => q.setNeurons.run(neurons, id),
  claimDaily: (id, neurons, when) => q.setDaily.run(neurons, when, id),
  userCounts: (id) => q.userCounts.get(id),

  grantCard(ownerId, cardId, foil = false) {
    const inst = { id: newId('c'), cardId, ownerId, obtainedAt: Date.now(), foil: foil ? 1 : 0 };
    q.insertInstance.run(inst.id, inst.cardId, inst.ownerId, inst.obtainedAt, inst.foil);
    return inst;
  },
  getInstance: (id) => q.getInstance.get(id),
  listByOwner: (ownerId) => q.listByOwner.all(ownerId),
  deleteInstance: (id) => q.deleteInstance.run(id),
  transferInstance: (id, ownerId) => q.setOwner.run(ownerId, id),

  createTrade({ fromId, toId, offer, request, message }) {
    const trade = { id: newId('t'), fromId, toId, offer, request, message, status: 'pending', createdAt: Date.now(), resolvedAt: null };
    q.insertTrade.run(trade.id, fromId, toId, JSON.stringify(offer), JSON.stringify(request), message, trade.createdAt);
    return trade;
  },
  getTrade: (id) => rowToTrade(q.getTrade.get(id)),
  listTradesFor: (userId) => q.listTradesFor.all(userId, userId).map(rowToTrade),
  resolveTrade: (id, status) => q.resolveTrade.run(status, Date.now(), id),

  // instances that must not change hands: sides of pending trades + active market listings
  lockedInstanceIds() {
    const locked = new Set();
    for (const r of q.pendingTrades.all()) {
      for (const id of [...JSON.parse(r.offer), ...JSON.parse(r.request)]) locked.add(id);
    }
    for (const r of q.activeListingIds.all()) locked.add(r.instanceId);
    return locked;
  },

  createMeme({ id, name, file, rarity, submitterId, status }) {
    q.insertMeme.run(id, name, file, rarity, submitterId, status, Date.now());
  },
  getMeme: (id) => q.getMeme.get(id),
  memesByStatus: (status) => q.memesByStatus.all(status),
  memesBySubmitter: (userId) => q.memesBySubmitter.all(userId),
  resolveMeme: (id, status) => q.resolveMeme.run(status, Date.now(), id),
  pendingCountBy: (userId) => q.countPendingBy.get(userId).n,
  pendingCount: () => q.countPending.get().n,
  approvedCountBy: (userId) => q.countApprovedBy.get(userId).n,

  unlockAchievement: (userId, achId) => q.unlockAch.run(userId, achId, Date.now()),
  listAchievements: (userId) => q.listAch.all(userId),
  bumpStat: (userId, key, by = 1) => q.bumpStat.run(userId, key, by),
  getStat: (userId, key) => (q.getStat.get(userId, key) || { value: 0 }).value,

  createBattle({ fromId, toId, wager, status, state }) {
    const battle = { id: newId('b'), fromId, toId, wager, status, state, winnerId: null, createdAt: Date.now(), updatedAt: Date.now() };
    q.insertBattle.run(battle.id, fromId, toId, wager, status, JSON.stringify(state), battle.createdAt, battle.updatedAt);
    return this.getBattle(battle.id);
  },
  getBattle: (id) => rowToBattle(q.getBattle.get(id)),
  listBattlesFor: (userId) => q.listBattlesFor.all(userId, userId).map(rowToBattle),
  saveBattle: (b) => q.updateBattle.run(b.status, JSON.stringify(b.state), b.winnerId, Date.now(), b.id),

  createListing({ instanceId, sellerId, price }) {
    const id = newId('l');
    q.insertListing.run(id, instanceId, sellerId, price, Date.now());
    return q.getListing.get(id);
  },
  getListing: (id) => q.getListing.get(id),
  activeListings: () => q.activeListings.all(),
  resolveListing: (id, status, buyerId = null) => q.resolveListing.run(status, buyerId, Date.now(), id),

  setShowcase: (userId, instanceIds) => q.setShowcase.run(JSON.stringify(instanceIds), userId),

  castVote: (week, voterId, memeId) => q.upsertVote.run(week, voterId, memeId, Date.now()),
  votesForWeek: (week) => q.votesForWeek.all(week),
  myVote: (week, voterId) => (q.myVote.get(week, voterId) || {}).memeId || null,
  getWinner: (week) => q.getWinner.get(week),
  latestWinner: () => q.latestWinner.get(),
  recordWinner: (week, memeId, submitterId) => q.insertWinner.run(week, memeId, submitterId, Date.now()),
  wotwWinsBy: (userId) => q.wotwWinsBy.get(userId).n,
  setMemeRarity: (id, rarity) => q.setMemeRarity.run(rarity, id),

  // Swap card ownership atomically, then mark the trade resolved.
  executeTrade(trade) {
    db.exec('BEGIN');
    try {
      for (const id of trade.offer) q.setOwner.run(trade.toId, id);
      for (const id of trade.request) q.setOwner.run(trade.fromId, id);
      q.resolveTrade.run('accepted', Date.now(), trade.id);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },
};

// ─── one-time migration from the legacy JSON store ───────────────────────────
(function migrateLegacyJSON() {
  const legacyPath = path.join(DATA_DIR, 'db.json');
  if (!fs.existsSync(legacyPath)) return;
  if (q.listUsers.all().length > 0) return; // sqlite already populated
  try {
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    const knownCards = new Set(CARDS.map((c) => c.id));
    db.exec('BEGIN');
    for (const u of Object.values(legacy.users || {})) {
      q.insertUser.run(u.id, u.discordId || null, u.name, u.avatar, u.bot ? 1 : 0, u.neurons | 0, u.lastDaily | 0, u.createdAt | 0);
    }
    let skipped = 0;
    for (const i of Object.values(legacy.inventory || {})) {
      if (!knownCards.has(i.cardId)) { skipped++; continue; } // card retired from the catalog
      q.insertInstance.run(i.id, i.cardId, i.ownerId, i.obtainedAt | 0, 0);
    }
    for (const t of Object.values(legacy.trades || {})) {
      q.insertTrade.run(t.id, t.fromId, t.toId, JSON.stringify(t.offer), JSON.stringify(t.request), t.message || '', t.createdAt | 0);
      if (t.status !== 'pending') q.resolveTrade.run(t.status, t.resolvedAt || t.createdAt, t.id);
    }
    db.exec('COMMIT');
    fs.renameSync(legacyPath, legacyPath + '.migrated');
    console.log(`Migrated legacy db.json to SQLite${skipped ? ` (${skipped} cards from retired sets dropped)` : ''}.`);
  } catch (e) {
    db.exec('ROLLBACK');
    console.error('Legacy db.json migration failed:', e.message);
  }
})();

module.exports = store;
