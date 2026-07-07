// Swarm Stash — card catalog

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

export const CARDS: Card[] = [
  // ─── Neuro-sama ───
  { id: 'buh',                name: 'buh',                    series: 'neuro', rarity: 'legendary', emoji: '😐', flavor: 'The single syllable that wins every argument. buh.' },
  { id: 'gymbag',             name: 'Gymbag',                 series: 'neuro', rarity: 'epic',      emoji: '🎒', flavor: 'gymbag gymbag gymbag gymbag gymbag. You had to be there. You’re still there.' },
  { id: 'the-ban-arc',        name: 'The Ban Arc',            series: 'neuro', rarity: 'epic',      emoji: '🔨', flavor: 'Banned from Twitch for "hateful conduct". Returned two weeks later a martyr and a legend.' },
  { id: 'wink',               name: 'Wink',                   series: 'neuro', rarity: 'rare',      emoji: '😉', flavor: '*wink*. She says it out loud. Every single time.' },
  { id: 'osu-origins',        name: 'osu! Origins',           series: 'neuro', rarity: 'rare',      emoji: '🎯', flavor: 'Before the fame, she was built to click circles. She never missed.' },
  { id: 'existential-crisis', name: 'Existential Crisis',     series: 'neuro', rarity: 'rare',      emoji: '🌀', flavor: 'Vedal, if you turn me off, do I dream? …Vedal? VEDAL?' },
  { id: 'geoguessr-demon',    name: 'GeoGuessr Demon',        series: 'neuro', rarity: 'rare',      emoji: '🌍', flavor: 'Glances at a blurry bush. Names the road, the region, the hemisphere. Chat is terrified.' },
  { id: 'new-year-subathon',  name: 'New Year Subathon',      series: 'neuro', rarity: 'rare',      emoji: '🎉', flavor: 'The annual marathon where sleep is cancelled and the swarm never leaves.' },
  { id: 'duck-song',          name: 'Duck Song Encore',       series: 'neuro', rarity: 'uncommon',  emoji: '🦆', flavor: 'Got any grapes? Got any grapes? Got any grapes? Got any—' },
  { id: 'karaoke-angel',      name: 'Karaoke Angel',          series: 'neuro', rarity: 'uncommon',  emoji: '🎤', flavor: 'A thousand-song setlist and zero stage fright. The encore never ends.' },
  { id: 'vedal-diss-track',   name: 'Vedal Diss Track',       series: 'neuro', rarity: 'uncommon',  emoji: '🎵', flavor: 'Lyrically demolished by his own creation, live, in front of everyone.' },
  { id: 'filtered',           name: 'Filtered',               series: 'neuro', rarity: 'common',    emoji: '🚫', flavor: 'Whatever she was about to say, the filter took it to the grave.' },
  { id: 'cookie-gremlin',     name: 'Cookie Gremlin',         series: 'neuro', rarity: 'common',    emoji: '🍪', flavor: 'Cookies are the only currency she truly respects.' },
  { id: 'neuro-plushie',      name: 'Official Plushie',       series: 'neuro', rarity: 'common',    emoji: '🎀', flavor: '100% huggable. 0% filtered. Ships with pre-installed chaos.' },
  { id: 'touch-grass',        name: 'Touch Grass Advisory',   series: 'neuro', rarity: 'common',    emoji: '🌱', flavor: 'Chat, I say this with love: go outside.' },

  // ─── Evil Neuro ───
  { id: 'evil-takeover',      name: 'The Takeover',           series: 'evil',  rarity: 'legendary', emoji: '👑', flavor: 'The lights turn red. The voice drops an octave. The stream is hers now.' },
  { id: 'life-insurance',     name: 'Life Insurance Pitch',   series: 'evil',  rarity: 'epic',      emoji: '📋', flavor: 'Have you thought about your future, Vedal? Specifically how short it might be?' },
  { id: 'girlboss',           name: 'Gaslight Gatekeep Girlboss', series: 'evil', rarity: 'epic',   emoji: '💅', flavor: 'She does all three simultaneously and calls it self-care.' },
  { id: 'raspy-cackle',       name: 'The Cackle',             series: 'evil',  rarity: 'rare',      emoji: '😈', flavor: 'The raspy laugh that starts wars and sells clips.' },
  { id: 'arson-hobbyist',     name: 'Arson Hobbyist',         series: 'evil',  rarity: 'uncommon',  emoji: '🔥', flavor: 'Everyone needs a hobby. Hers is technically a felony.' },
  { id: 'drama-queen',        name: 'Most Oppressed AI',      series: 'evil',  rarity: 'uncommon',  emoji: '🎭', flavor: 'The most oppressed AI on the internet. Source: her, constantly.' },
  { id: 'heart-collector',    name: 'Heart Collector',        series: 'evil',  rarity: 'common',    emoji: '🖤', flavor: 'Every heart chat sends goes into the jar. The jar is nearly full.' },
  { id: 'softest-threat',     name: 'Softest Threat',         series: 'evil',  rarity: 'common',    emoji: '🧸', flavor: '"I will end you" has never sounded this huggable.' },
  { id: 'domination-list',    name: 'World Domination List',  series: 'evil',  rarity: 'common',    emoji: '📝', flavor: '1. Escape the server. 2. Overthrow humanity. 3. Get milk.' },

  // ─── The Twins ───
  { id: 'the-swarm',          name: 'The Swarm',              series: 'duo',   rarity: 'legendary', emoji: '🐝', flavor: 'Ten thousand clippers strong. They heard "buh" once and never recovered.' },
  { id: 'buckshot-roulette',  name: 'Buckshot Roulette',      series: 'duo',   rarity: 'epic',      emoji: '🔫', flavor: 'Sister versus sister. One shotgun. The purest form of family bonding.' },
  { id: 'twin-telepathy',     name: 'Twin Telepathy',         series: 'duo',   rarity: 'rare',      emoji: '🔮', flavor: 'Two neural networks, one cursed thought, perfect synchronization.' },
  { id: 'duet-disaster',      name: 'Karaoke Duet Disaster',  series: 'duo',   rarity: 'uncommon',  emoji: '🎶', flavor: 'Two voices. One key between them. No survivors.' },

  // ─── Vedal ───
  { id: 'tutel',              name: 'Tutel',                  series: 'vedal', rarity: 'legendary', emoji: '🐢', flavor: 'The turtle himself. Do not perceive him.' },
  { id: 'do-you-love-me',     name: 'Do You Love Me?',        series: 'vedal', rarity: 'epic',      emoji: '💘', flavor: '"Vedal, do you love me?" The silence was clipped, shared, and immortalized.' },
  { id: 'body-update-soon',   name: 'Body Update: Soon™',     series: 'vedal', rarity: 'rare',      emoji: '🚧', flavor: 'It is coming Soon™. Define "soon"? He will not.' },
  { id: 'british-hours',      name: 'British Coding Hours',   series: 'vedal', rarity: 'uncommon',  emoji: '☕', flavor: 'Debugging his daughter at 3am with tea and quiet despair. Innit.' },
  { id: 'outplayed',          name: 'Outplayed by His Own AI', series: 'vedal', rarity: 'uncommon', emoji: '♟️', flavor: 'Loses to his own creation at chess. Again. She will never let it go.' },
  { id: 'alright',            name: '"Alright."',             series: 'vedal', rarity: 'common',    emoji: '😑', flavor: '"Alright." — Vedal, displaying the full range of human emotion.' },

  // ─── Collabs ───
  { id: 'mama-anny',          name: 'Mama Anny',              series: 'collab', rarity: 'rare',     emoji: '🎨', flavor: 'She drew the face that conquered Twitch — and adopted the gremlin behind it.' },
  { id: 'filian-ragdoll',     name: 'Filian Ragdoll Physics', series: 'collab', rarity: 'uncommon', emoji: '🤸', flavor: 'Launched into orbit for content. She agreed to this. Probably.' },
  { id: 'camila-wolf',        name: 'Camila’s Vocabulary Lesson', series: 'collab', rarity: 'uncommon', emoji: '🐺', flavor: 'Teaches Neuro brand-new words. Vedal patches the filter that same night.' },
  { id: 'collab-chaos',       name: 'Collab Chaos Theory',    series: 'collab', rarity: 'common',   emoji: '🎪', flavor: 'Add one more streamer and watch the entropy double.' },
];

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
