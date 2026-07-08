// SQLite storage layer (node:sqlite — built into Node ≥22.18, zero runtime deps).

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Rarity, SeriesId, Card } from './catalog.ts';
import type { BattleState } from './battle.ts';

// ─── row shapes ──────────────────────────────────────────────────────────────
// SQLite has no booleans: bot/foil are 0|1 integers; showcase is a JSON string.

export interface UserRow {
  id: string;
  discordId: string | null;
  name: string;
  avatar: string;
  bot: number;
  neuros: number;
  lastDaily: number;
  createdAt: number;
  showcase: string;
}

export interface InstanceRow {
  id: string;
  cardId: string;
  ownerId: string;
  obtainedAt: number;
  foil: number;
}

export type TradeStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired';
export interface Trade {
  id: string;
  fromId: string;
  toId: string;
  offer: string[];   // instance ids
  request: string[]; // instance ids
  message: string;
  status: TradeStatus;
  createdAt: number;
  resolvedAt: number | null;
}
type TradeRow = Omit<Trade, 'offer' | 'request'> & { offer: string; request: string };

export type MemeStatus = 'pending' | 'approved' | 'rejected';
export interface MemeRow {
  id: string;
  name: string;
  file: string;
  rarity: Rarity;
  submitterId: string;
  status: MemeStatus;
  createdAt: number;
  resolvedAt: number | null;
  submitterName?: string;   // present on joined queries
  submitterAvatar?: string;
}

export type BattleStatus = 'pending' | 'active' | 'done' | 'declined' | 'cancelled';
export interface Battle {
  id: string;
  fromId: string;
  toId: string;
  wager: number;
  status: BattleStatus;
  state: BattleState;
  winnerId: string | null;
  createdAt: number;
  updatedAt: number;
}
type BattleRow = Omit<Battle, 'state'> & { state: string };

export type ListingStatus = 'active' | 'sold' | 'cancelled';
export interface ListingRow {
  id: string;
  instanceId: string;
  sellerId: string;
  price: number;
  status: ListingStatus;
  buyerId: string | null;
  createdAt: number;
  resolvedAt: number | null;
  sellerName?: string;    // present on joined queries
  sellerAvatar?: string;
}

export type AuctionStatus = 'active' | 'sold' | 'expired' | 'cancelled';
export interface AuctionRow {
  id: string;
  instanceId: string;
  sellerId: string;
  startingBid: number;
  currentBid: number | null;
  currentBidderId: string | null;
  durationHours: number;
  endsAt: number;
  status: AuctionStatus;
  createdAt: number;
  resolvedAt: number | null;
  sellerName?: string;      // present on joined queries
  sellerAvatar?: string;
  bidderName?: string | null;
  bidderAvatar?: string | null;
  bidCount?: number;        // attached by activeAuctions()
}

export interface CardRow {
  id: string;
  name: string;
  series: string;
  rarity: string;
  emoji: string;
  flavor: string;
  image: string | null;
}

export interface AchievementRow { achId: string; unlockedAt: number }
export interface WeeklyWinnerRow { week: string; memeId: string; submitterId: string; decidedAt: number }
export interface VoteTally { memeId: string; n: number }

// ─── database ────────────────────────────────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || path.join(import.meta.dirname, 'data');
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
    neuros    INTEGER NOT NULL DEFAULT 0,
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

  -- The built-in lore card catalog. Seeded once on startup from
  -- lib/seed-cards.ts; edited live via the admin page. Community meme cards
  -- still live in the memes table and are merged into the pool at runtime.
  CREATE TABLE IF NOT EXISTS cards (
    id     TEXT PRIMARY KEY,
    name   TEXT NOT NULL,
    series TEXT NOT NULL,
    rarity TEXT NOT NULL,
    emoji  TEXT NOT NULL,
    flavor TEXT NOT NULL,
    image  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cards_rarity ON cards(rarity);

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

  -- Auction-house listings: sellers set a starting bid + duration (hours, max
  -- 168 = 1 week); bidders' neuros are escrowed (deducted) the moment they
  -- bid and refunded the moment they're outbid, so the current highest bid
  -- is always already "paid in" and settlement at expiry is just a transfer.
  CREATE TABLE IF NOT EXISTS auctions (
    id              TEXT PRIMARY KEY,
    instanceId      TEXT NOT NULL,
    sellerId        TEXT NOT NULL REFERENCES users(id),
    startingBid     INTEGER NOT NULL,
    currentBid      INTEGER,
    currentBidderId TEXT,
    durationHours   INTEGER NOT NULL,
    endsAt          INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT 'active',  -- active | sold | expired | cancelled
    createdAt       INTEGER NOT NULL,
    resolvedAt      INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
  CREATE INDEX IF NOT EXISTS idx_auctions_ends ON auctions(endsAt);

  CREATE TABLE IF NOT EXISTS auction_bids (
    id        TEXT PRIMARY KEY,
    auctionId TEXT NOT NULL REFERENCES auctions(id),
    bidderId  TEXT NOT NULL REFERENCES users(id),
    amount    INTEGER NOT NULL,
    createdAt INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_bids_auction ON auction_bids(auctionId);

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

// in-place schema upgrades for databases created by earlier versions
try { db.exec(`ALTER TABLE inventory ADD COLUMN foil INTEGER NOT NULL DEFAULT 0`); } catch { /* up to date */ }
try { db.exec(`ALTER TABLE users ADD COLUMN showcase TEXT NOT NULL DEFAULT '[]'`); } catch { /* up to date */ }
try { db.exec(`ALTER TABLE users RENAME COLUMN neurons TO neuros`); } catch { /* up to date */ }

const newId = (prefix: string): string => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

// ─── prepared statements ─────────────────────────────────────────────────────
const q = {
  insertUser: db.prepare(`INSERT INTO users (id, discordId, name, avatar, bot, neuros, lastDaily, createdAt)
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getUser: db.prepare(`SELECT * FROM users WHERE id = ?`),
  getUserByDiscord: db.prepare(`SELECT * FROM users WHERE discordId = ?`),
  getDevUserByName: db.prepare(`SELECT * FROM users WHERE discordId IS NULL AND bot = 0 AND lower(name) = lower(?)`),
  getUserByName: db.prepare(`SELECT * FROM users WHERE name = ?`),
  listUsers: db.prepare(`SELECT * FROM users`),
  setProfile: db.prepare(`UPDATE users SET name = ?, avatar = ? WHERE id = ?`),
  setNeuros: db.prepare(`UPDATE users SET neuros = ? WHERE id = ?`),
  setDaily: db.prepare(`UPDATE users SET neuros = ?, lastDaily = ? WHERE id = ?`),
  userCounts: db.prepare(`SELECT COUNT(*) AS cardCount, COUNT(DISTINCT cardId) AS uniqueCount FROM inventory WHERE ownerId = ?`),

  insertInstance: db.prepare(`INSERT INTO inventory (id, cardId, ownerId, obtainedAt, foil) VALUES (?, ?, ?, ?, ?)`),
  getInstance: db.prepare(`SELECT * FROM inventory WHERE id = ?`),
  listByOwner: db.prepare(`SELECT * FROM inventory WHERE ownerId = ? ORDER BY obtainedAt DESC`),
  setOwner: db.prepare(`UPDATE inventory SET ownerId = ? WHERE id = ?`),
  deleteInstance: db.prepare(`DELETE FROM inventory WHERE id = ?`),

  listCards: db.prepare(`SELECT * FROM cards ORDER BY series, name`),
  getCardRow: db.prepare(`SELECT * FROM cards WHERE id = ?`),
  insertCard: db.prepare(`INSERT INTO cards (id, name, series, rarity, emoji, flavor, image)
                          VALUES (?, ?, ?, ?, ?, ?, ?)`),
  updateCard: db.prepare(`UPDATE cards SET name = ?, series = ?, rarity = ?, emoji = ?, flavor = ?, image = ? WHERE id = ?`),
  deleteCard: db.prepare(`DELETE FROM cards WHERE id = ?`),
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

  insertAuction: db.prepare(`INSERT INTO auctions (id, instanceId, sellerId, startingBid, durationHours, endsAt, status, createdAt)
                             VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`),
  getAuction: db.prepare(`SELECT * FROM auctions WHERE id = ?`),
  activeAuctions: db.prepare(`SELECT a.*, u.name AS sellerName, u.avatar AS sellerAvatar,
                              bu.name AS bidderName, bu.avatar AS bidderAvatar
                              FROM auctions a JOIN users u ON u.id = a.sellerId
                              LEFT JOIN users bu ON bu.id = a.currentBidderId
                              WHERE a.status = 'active' ORDER BY a.endsAt ASC`),
  activeAuctionIds: db.prepare(`SELECT instanceId FROM auctions WHERE status = 'active'`),
  dueAuctions: db.prepare(`SELECT * FROM auctions WHERE status = 'active' AND endsAt <= ?`),
  placeAuctionBid: db.prepare(`UPDATE auctions SET currentBid = ?, currentBidderId = ? WHERE id = ?`),
  resolveAuctionRow: db.prepare(`UPDATE auctions SET status = ?, resolvedAt = ? WHERE id = ?`),
  insertBid: db.prepare(`INSERT INTO auction_bids (id, auctionId, bidderId, amount, createdAt) VALUES (?, ?, ?, ?, ?)`),
  bidCount: db.prepare(`SELECT COUNT(*) AS n FROM auction_bids WHERE auctionId = ?`),

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

const rowToTrade = (r: TradeRow | undefined): Trade | undefined =>
  r && { ...r, offer: JSON.parse(r.offer), request: JSON.parse(r.request) };
const rowToCard = (r: CardRow | undefined): Card | undefined =>
  r && { id: r.id, name: r.name, series: r.series as SeriesId, rarity: r.rarity as Rarity,
         emoji: r.emoji, flavor: r.flavor, image: r.image ?? undefined };
const rowToBattle = (r: BattleRow | undefined): Battle | undefined =>
  r && { ...r, state: JSON.parse(r.state) };

// ─── public API ──────────────────────────────────────────────────────────────
const store = {
  newId,

  createUser({ discordId = null, name, avatar, bot = false, neuros = 0 }:
             { discordId?: string | null; name: string; avatar: string; bot?: boolean; neuros?: number }): UserRow {
    const user: UserRow = { id: newId('u'), discordId, name, avatar, bot: bot ? 1 : 0, neuros, lastDaily: 0, createdAt: Date.now(), showcase: '[]' };
    q.insertUser.run(user.id, user.discordId, user.name, user.avatar, user.bot, user.neuros, user.lastDaily, user.createdAt);
    return user;
  },
  getUser: (id: string) => q.getUser.get(id) as unknown as UserRow | undefined,
  getUserByDiscord: (discordId: string) => q.getUserByDiscord.get(discordId) as unknown as UserRow | undefined,
  getDevUserByName: (name: string) => q.getDevUserByName.get(name) as unknown as UserRow | undefined,
  getUserByName: (name: string) => q.getUserByName.get(name) as unknown as UserRow | undefined,
  listUsers: () => q.listUsers.all() as unknown as UserRow[],
  setProfile: (id: string, name: string, avatar: string) => q.setProfile.run(name, avatar, id),
  setNeuros: (id: string, neuros: number) => q.setNeuros.run(neuros, id),
  claimDaily: (id: string, neuros: number, when: number) => q.setDaily.run(neuros, when, id),
  userCounts: (id: string) => q.userCounts.get(id) as unknown as { cardCount: number; uniqueCount: number },

  grantCard(ownerId: string, cardId: string, foil = false): InstanceRow {
    const inst: InstanceRow = { id: newId('c'), cardId, ownerId, obtainedAt: Date.now(), foil: foil ? 1 : 0 };
    q.insertInstance.run(inst.id, inst.cardId, inst.ownerId, inst.obtainedAt, inst.foil);
    return inst;
  },
  getInstance: (id: string) => q.getInstance.get(id) as unknown as InstanceRow | undefined,
  listByOwner: (ownerId: string) => q.listByOwner.all(ownerId) as unknown as InstanceRow[],
  deleteInstance: (id: string) => q.deleteInstance.run(id),
  transferInstance: (id: string, ownerId: string) => q.setOwner.run(ownerId, id),

  listCards: (): Card[] => (q.listCards.all() as unknown as CardRow[]).map((r) => rowToCard(r)!),
  getCard: (id: string): Card | undefined => rowToCard(q.getCardRow.get(id) as unknown as CardRow | undefined),
  createCard({ id, name, series, rarity, emoji, flavor, image }:
             { id: string; name: string; series: SeriesId; rarity: Rarity; emoji: string; flavor: string; image?: string }): Card {
    q.insertCard.run(id, name, series, rarity, emoji, flavor, image ?? null);
    return rowToCard(q.getCardRow.get(id) as unknown as CardRow)!;
  },
  updateCard(id: string, { name, series, rarity, emoji, flavor, image }:
             { name: string; series: SeriesId; rarity: Rarity; emoji: string; flavor: string; image?: string }): void {
    q.updateCard.run(name, series, rarity, emoji, flavor, image ?? null, id);
  },
  deleteCard: (id: string) => q.deleteCard.run(id),

  createTrade({ fromId, toId, offer, request, message }:
              { fromId: string; toId: string; offer: string[]; request: string[]; message: string }): Trade {
    const trade: Trade = { id: newId('t'), fromId, toId, offer, request, message, status: 'pending', createdAt: Date.now(), resolvedAt: null };
    q.insertTrade.run(trade.id, fromId, toId, JSON.stringify(offer), JSON.stringify(request), message, trade.createdAt);
    return trade;
  },
  getTrade: (id: string) => rowToTrade(q.getTrade.get(id) as unknown as TradeRow | undefined),
  listTradesFor: (userId: string) => (q.listTradesFor.all(userId, userId) as unknown as TradeRow[]).map((r) => rowToTrade(r)!),
  resolveTrade: (id: string, status: TradeStatus) => q.resolveTrade.run(status, Date.now(), id),

  // instances that must not change hands: sides of pending trades + active market listings/auctions
  lockedInstanceIds(): Set<string> {
    const locked = new Set<string>();
    for (const r of q.pendingTrades.all() as unknown as { offer: string; request: string }[]) {
      for (const id of [...JSON.parse(r.offer), ...JSON.parse(r.request)] as string[]) locked.add(id);
    }
    for (const r of q.activeListingIds.all() as unknown as { instanceId: string }[]) locked.add(r.instanceId);
    for (const r of q.activeAuctionIds.all() as unknown as { instanceId: string }[]) locked.add(r.instanceId);
    return locked;
  },

  createMeme({ id, name, file, rarity, submitterId, status }:
             { id: string; name: string; file: string; rarity: Rarity; submitterId: string; status: MemeStatus }): void {
    q.insertMeme.run(id, name, file, rarity, submitterId, status, Date.now());
  },
  getMeme: (id: string) => q.getMeme.get(id) as unknown as MemeRow | undefined,
  memesByStatus: (status: MemeStatus) => q.memesByStatus.all(status) as unknown as MemeRow[],
  memesBySubmitter: (userId: string) => q.memesBySubmitter.all(userId) as unknown as MemeRow[],
  resolveMeme: (id: string, status: MemeStatus) => q.resolveMeme.run(status, Date.now(), id),
  pendingCountBy: (userId: string) => (q.countPendingBy.get(userId) as unknown as { n: number }).n,
  pendingCount: () => (q.countPending.get() as unknown as { n: number }).n,
  approvedCountBy: (userId: string) => (q.countApprovedBy.get(userId) as unknown as { n: number }).n,

  unlockAchievement: (userId: string, achId: string) => q.unlockAch.run(userId, achId, Date.now()),
  listAchievements: (userId: string) => q.listAch.all(userId) as unknown as AchievementRow[],
  bumpStat: (userId: string, key: string, by = 1) => q.bumpStat.run(userId, key, by),
  getStat: (userId: string, key: string) => ((q.getStat.get(userId, key) as unknown as { value: number } | undefined) ?? { value: 0 }).value,

  createBattle({ fromId, toId, wager, status, state }:
               { fromId: string; toId: string; wager: number; status: BattleStatus; state: BattleState }): Battle {
    const id = newId('b');
    const now = Date.now();
    q.insertBattle.run(id, fromId, toId, wager, status, JSON.stringify(state), now, now);
    return rowToBattle(q.getBattle.get(id) as unknown as BattleRow)!;
  },
  getBattle: (id: string) => rowToBattle(q.getBattle.get(id) as unknown as BattleRow | undefined),
  listBattlesFor: (userId: string) => (q.listBattlesFor.all(userId, userId) as unknown as BattleRow[]).map((r) => rowToBattle(r)!),
  saveBattle: (b: Battle) => q.updateBattle.run(b.status, JSON.stringify(b.state), b.winnerId, Date.now(), b.id),

  createListing({ instanceId, sellerId, price }: { instanceId: string; sellerId: string; price: number }): ListingRow {
    const id = newId('l');
    q.insertListing.run(id, instanceId, sellerId, price, Date.now());
    return q.getListing.get(id) as unknown as ListingRow;
  },
  getListing: (id: string) => q.getListing.get(id) as unknown as ListingRow | undefined,
  activeListings: () => q.activeListings.all() as unknown as ListingRow[],
  resolveListing: (id: string, status: ListingStatus, buyerId: string | null = null) =>
    q.resolveListing.run(status, buyerId, Date.now(), id),

  createAuction({ instanceId, sellerId, startingBid, durationHours }:
                { instanceId: string; sellerId: string; startingBid: number; durationHours: number }): AuctionRow {
    const id = newId('a');
    const now = Date.now();
    const endsAt = now + durationHours * 3600e3;
    q.insertAuction.run(id, instanceId, sellerId, startingBid, durationHours, endsAt, now);
    return q.getAuction.get(id) as unknown as AuctionRow;
  },
  getAuction: (id: string) => q.getAuction.get(id) as unknown as AuctionRow | undefined,
  activeAuctions: (): AuctionRow[] => (q.activeAuctions.all() as unknown as AuctionRow[])
    .map((a) => ({ ...a, bidCount: (q.bidCount.get(a.id) as unknown as { n: number }).n })),
  bidsFor: (auctionId: string) => (q.bidCount.get(auctionId) as unknown as { n: number }).n,

  // Escrow model: the bidder's neuros are deducted the instant the bid lands,
  // and the previous highest bidder (if any) is refunded in the same
  // transaction — so `currentBid` on the row is always neuros that are
  // already sitting in escrow, and settling the auction later is just a
  // straight transfer, never a fresh charge that could fail.
  placeBid(auctionId: string, bidderId: string, amount: number): AuctionRow {
    db.exec('BEGIN');
    try {
      const a = q.getAuction.get(auctionId) as unknown as AuctionRow | undefined;
      if (!a || a.status !== 'active' || a.endsAt <= Date.now()) throw new Error('auction is no longer active');
      if (a.sellerId === bidderId) throw new Error('you cannot bid on your own auction');
      const floor = a.currentBid != null ? a.currentBid + 1 : a.startingBid;
      if (amount < floor) throw new Error(`bid must be at least ⚡${floor}`);
      const bidder = q.getUser.get(bidderId) as unknown as UserRow | undefined;
      if (!bidder || bidder.neuros < amount) throw new Error('not enough neuros for that bid');

      q.setNeuros.run(bidder.neuros - amount, bidderId);
      if (a.currentBidderId) {
        const prev = q.getUser.get(a.currentBidderId) as unknown as UserRow | undefined;
        if (prev) q.setNeuros.run(prev.neuros + a.currentBid!, prev.id);
      }
      q.placeAuctionBid.run(amount, bidderId, auctionId);
      q.insertBid.run(newId('bid'), auctionId, bidderId, amount, Date.now());
      db.exec('COMMIT');
      return q.getAuction.get(auctionId) as unknown as AuctionRow;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  },

  // No bids yet → free to cancel (nothing in escrow to refund but the seller's own card).
  cancelAuction(id: string): void {
    const a = q.getAuction.get(id) as unknown as AuctionRow | undefined;
    if (a && a.currentBidderId) throw new Error('cannot cancel an auction that already has a bid');
    q.resolveAuctionRow.run('cancelled', Date.now(), id);
  },

  // Called periodically (and opportunistically on market reads) to settle
  // anything whose clock has run out: sold → transfer card + pay seller;
  // no-bid → just expire, card stays put, nothing was ever escrowed from the seller.
  resolveExpiredAuctions(): number {
    const due = q.dueAuctions.all(Date.now()) as unknown as AuctionRow[];
    for (const a of due) {
      db.exec('BEGIN');
      try {
        if (a.currentBidderId) {
          const inst = q.getInstance.get(a.instanceId) as unknown as InstanceRow | undefined;
          if (inst && inst.ownerId === a.sellerId) q.setOwner.run(a.currentBidderId, a.instanceId);
          const seller = q.getUser.get(a.sellerId) as unknown as UserRow | undefined;
          if (seller) q.setNeuros.run(seller.neuros + a.currentBid!, a.sellerId);
          q.resolveAuctionRow.run('sold', Date.now(), a.id);
        } else {
          q.resolveAuctionRow.run('expired', Date.now(), a.id);
        }
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        console.error('auction settle failed', a.id, e);
      }
    }
    return due.length;
  },

  setShowcase: (userId: string, instanceIds: string[]) => q.setShowcase.run(JSON.stringify(instanceIds), userId),

  castVote: (week: string, voterId: string, memeId: string) => q.upsertVote.run(week, voterId, memeId, Date.now()),
  votesForWeek: (week: string) => q.votesForWeek.all(week) as unknown as VoteTally[],
  myVote: (week: string, voterId: string): string | null =>
    (q.myVote.get(week, voterId) as unknown as { memeId: string } | undefined)?.memeId ?? null,
  getWinner: (week: string) => q.getWinner.get(week) as unknown as WeeklyWinnerRow | undefined,
  latestWinner: () => q.latestWinner.get() as unknown as WeeklyWinnerRow | undefined,
  recordWinner: (week: string, memeId: string, submitterId: string) => q.insertWinner.run(week, memeId, submitterId, Date.now()),
  wotwWinsBy: (userId: string) => (q.wotwWinsBy.get(userId) as unknown as { n: number }).n,
  setMemeRarity: (id: string, rarity: Rarity) => q.setMemeRarity.run(rarity, id),

  // Swap card ownership atomically, then mark the trade resolved.
  executeTrade(trade: Trade): void {
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

export default store;
