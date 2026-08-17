/**
 * Every kind of counter Magic has printed.
 *
 * Transcribed from the MTG Wiki's full list:
 *   https://mtg.fandom.com/wiki/Counter_(marker)/Full_List
 *
 * Three groups, because the board treats them differently:
 *
 *   power    ±X/±Y counters. These change a creature's printed stats, so the
 *            rules engine reads them. +1/+1 and -1/-1 annihilate in pairs
 *            (CR 704.5q); the rest are deprecated but still exist on old cards.
 *   keyword  Counters that grant their named ability to the permanent.
 *   named    Everything else. These are markers: the board tracks how many are
 *            on a card and shows them, and the card's own text says what they
 *            mean. That is exactly how they work in paper.
 *
 * `kind` is the stable key stored on the card and in saved puzzles; `name` is
 * what a person reads. Never renumber or rename a `kind` — published puzzles
 * refer to them.
 */

const POWER_COUNTERS = [
  { kind: "+1/+1", name: "+1/+1" },
  { kind: "-1/-1", name: "-1/-1" },
  { kind: "+0/+1", name: "+0/+1" },
  { kind: "+0/+2", name: "+0/+2" },
  { kind: "+1/+0", name: "+1/+0" },
  { kind: "+1/+2", name: "+1/+2" },
  { kind: "+2/+0", name: "+2/+0" },
  { kind: "+2/+2", name: "+2/+2" },
  { kind: "-0/-1", name: "-0/-1" },
  { kind: "-0/-2", name: "-0/-2" },
  { kind: "-1/-0", name: "-1/-0" },
  { kind: "-2/-1", name: "-2/-1" },
  { kind: "-2/-2", name: "-2/-2" },
];

const KEYWORD_COUNTERS = [
  { kind: "deathtouch", name: "Deathtouch" },
  { kind: "double-strike", name: "Double strike" },
  { kind: "first-strike", name: "First strike" },
  { kind: "flying", name: "Flying" },
  { kind: "haste", name: "Haste" },
  { kind: "hexproof", name: "Hexproof" },
  { kind: "indestructible", name: "Indestructible" },
  { kind: "lifelink", name: "Lifelink" },
  { kind: "menace", name: "Menace" },
  { kind: "reach", name: "Reach" },
  { kind: "trample", name: "Trample" },
  { kind: "vigilance", name: "Vigilance" },
  { kind: "shadow", name: "Shadow" },
  { kind: "exalted", name: "Exalted" },
];

const NAMED_COUNTERS = [
  { kind: "acorn", name: "Acorn" },
  { kind: "aegis", name: "Aegis" },
  { kind: "age", name: "Age" },
  { kind: "aim", name: "Aim" },
  { kind: "arrow", name: "Arrow" },
  { kind: "arrowhead", name: "Arrowhead" },
  { kind: "awakening", name: "Awakening" },
  { kind: "bait", name: "Bait" },
  { kind: "blaze", name: "Blaze" },
  { kind: "blessing", name: "Blessing" },
  { kind: "blight", name: "Blight" },
  { kind: "blood", name: "Blood" },
  { kind: "bloodline", name: "Bloodline" },
  { kind: "bloodstain", name: "Bloodstain" },
  { kind: "book", name: "Book" },
  { kind: "bounty", name: "Bounty" },
  { kind: "brain", name: "Brain" },
  { kind: "bribery", name: "Bribery" },
  { kind: "brick", name: "Brick" },
  { kind: "burden", name: "Burden" },
  { kind: "cage", name: "Cage" },
  { kind: "carrion", name: "Carrion" },
  { kind: "charge", name: "Charge" },
  { kind: "coin", name: "Coin" },
  { kind: "collection", name: "Collection" },
  { kind: "component", name: "Component" },
  { kind: "contested", name: "Contested" },
  { kind: "corpse", name: "Corpse" },
  { kind: "corruption", name: "Corruption" },
  { kind: "crank", name: "CRANK!" },
  { kind: "credit", name: "Credit" },
  { kind: "croak", name: "Croak" },
  { kind: "crystal", name: "Crystal" },
  { kind: "cube", name: "Cube" },
  { kind: "currency", name: "Currency" },
  { kind: "death", name: "Death" },
  { kind: "defense", name: "Defense" },
  { kind: "delay", name: "Delay" },
  { kind: "depletion", name: "Depletion" },
  { kind: "descent", name: "Descent" },
  { kind: "despair", name: "Despair" },
  { kind: "devotion", name: "Devotion" },
  { kind: "discovery", name: "Discovery" },
  { kind: "divinity", name: "Divinity" },
  { kind: "doom", name: "Doom" },
  { kind: "dream", name: "Dream" },
  { kind: "duty", name: "Duty" },
  { kind: "echo", name: "Echo" },
  { kind: "egg", name: "Egg" },
  { kind: "elixir", name: "Elixir" },
  { kind: "ember", name: "Ember" },
  { kind: "energy", name: "Energy" },
  { kind: "enlightened", name: "Enlightened" },
  { kind: "eon", name: "Eon" },
  { kind: "eruption", name: "Eruption" },
  { kind: "everything", name: "Everything" },
  { kind: "experience", name: "Experience" },
  { kind: "eyeball", name: "Eyeball" },
  { kind: "eyestalk", name: "Eyestalk" },
  { kind: "fade", name: "Fade" },
  { kind: "fate", name: "Fate" },
  { kind: "feather", name: "Feather" },
  { kind: "feeding", name: "Feeding" },
  { kind: "fellowship", name: "Fellowship" },
  { kind: "fetch", name: "Fetch" },
  { kind: "filibuster", name: "Filibuster" },
  { kind: "finality", name: "Finality" },
  { kind: "flame", name: "Flame" },
  { kind: "flood", name: "Flood" },
  { kind: "foreshadow", name: "Foreshadow" },
  { kind: "fungus", name: "Fungus" },
  { kind: "fury", name: "Fury" },
  { kind: "fuse", name: "Fuse" },
  { kind: "gem", name: "Gem" },
  { kind: "ghostform", name: "Ghostform" },
  { kind: "glyph", name: "Glyph" },
  { kind: "gold", name: "Gold" },
  { kind: "growth", name: "Growth" },
  { kind: "hack", name: "Hack" },
  { kind: "harmony", name: "Harmony" },
  { kind: "hatching", name: "Hatching" },
  { kind: "hatchling", name: "Hatchling" },
  { kind: "healing", name: "Healing" },
  { kind: "hit", name: "Hit" },
  { kind: "hone", name: "Hone" },
  { kind: "hoofprint", name: "Hoofprint" },
  { kind: "hope", name: "Hope" },
  { kind: "hour", name: "Hour" },
  { kind: "hourglass", name: "Hourglass" },
  { kind: "hunger", name: "Hunger" },
  { kind: "ice", name: "Ice" },
  { kind: "impostor", name: "Impostor" },
  { kind: "incarnation", name: "Incarnation" },
  { kind: "incubation", name: "Incubation" },
  { kind: "infection", name: "Infection" },
  { kind: "influence", name: "Influence" },
  { kind: "ingenuity", name: "Ingenuity" },
  { kind: "intel", name: "Intel" },
  { kind: "intervention", name: "Intervention" },
  { kind: "invitation", name: "Invitation" },
  { kind: "isolation", name: "Isolation" },
  { kind: "javelin", name: "Javelin" },
  { kind: "judgment", name: "Judgment" },
  { kind: "ki", name: "Ki" },
  { kind: "kick", name: "Kick" },
  { kind: "knickknack", name: "Knickknack" },
  { kind: "knowledge", name: "Knowledge" },
  { kind: "landmark", name: "Landmark" },
  { kind: "level", name: "Level" },
  { kind: "loot", name: "Loot" },
  { kind: "lore", name: "Lore" },
  { kind: "loyalty", name: "Loyalty" },
  { kind: "luck", name: "Luck" },
  { kind: "magnet", name: "Magnet" },
  { kind: "manabond", name: "Manabond" },
  { kind: "manifestation", name: "Manifestation" },
  { kind: "mannequin", name: "Mannequin" },
  { kind: "mask", name: "Mask" },
  { kind: "matrix", name: "Matrix" },
  { kind: "memory", name: "Memory" },
  { kind: "midway", name: "Midway" },
  { kind: "mine", name: "Mine" },
  { kind: "mining", name: "Mining" },
  { kind: "mire", name: "Mire" },
  { kind: "music", name: "Music" },
  { kind: "muster", name: "Muster" },
  { kind: "necrodermis", name: "Necrodermis" },
  { kind: "nest", name: "Nest" },
  { kind: "net", name: "Net" },
  { kind: "night", name: "Night" },
  { kind: "oil", name: "Oil" },
  { kind: "omen", name: "Omen" },
  { kind: "ore", name: "Ore" },
  { kind: "page", name: "Page" },
  { kind: "pain", name: "Pain" },
  { kind: "palliation", name: "Palliation" },
  { kind: "paralyzation", name: "Paralyzation" },
  { kind: "pause", name: "Pause" },
  { kind: "petal", name: "Petal" },
  { kind: "petrification", name: "Petrification" },
  { kind: "phylactery", name: "Phylactery" },
  { kind: "phyresis", name: "Phyresis" },
  { kind: "pin", name: "Pin" },
  { kind: "plague", name: "Plague" },
  { kind: "plot", name: "Plot" },
  { kind: "point", name: "Point" },
  { kind: "poison", name: "Poison" },
  { kind: "polyp", name: "Polyp" },
  { kind: "possession", name: "Possession" },
  { kind: "pressure", name: "Pressure" },
  { kind: "prey", name: "Prey" },
  { kind: "pupa", name: "Pupa" },
  { kind: "quest", name: "Quest" },
  { kind: "rad", name: "Rad" },
  { kind: "rejection", name: "Rejection" },
  { kind: "reprieve", name: "Reprieve" },
  { kind: "rev", name: "Rev" },
  { kind: "revival", name: "Revival" },
  { kind: "ribbon", name: "Ribbon" },
  { kind: "ritual", name: "Ritual" },
  { kind: "rope", name: "Rope" },
  { kind: "rust", name: "Rust" },
  { kind: "scream", name: "Scream" },
  { kind: "scroll", name: "Scroll" },
  { kind: "shell", name: "Shell" },
  { kind: "shield", name: "Shield" },
  { kind: "shred", name: "Shred" },
  { kind: "silver", name: "Silver" },
  { kind: "sleep", name: "Sleep" },
  { kind: "sleight", name: "Sleight" },
  { kind: "slime", name: "Slime" },
  { kind: "slumber", name: "Slumber" },
  { kind: "soot", name: "Soot" },
  { kind: "soul", name: "Soul" },
  { kind: "spark", name: "Spark" },
  { kind: "spite", name: "Spite" },
  { kind: "spore", name: "Spore" },
  { kind: "stash", name: "Stash" },
  { kind: "storage", name: "Storage" },
  { kind: "story", name: "Story" },
  { kind: "strife", name: "Strife" },
  { kind: "study", name: "Study" },
  { kind: "stun", name: "Stun" },
  { kind: "supply", name: "Supply" },
  { kind: "suspect", name: "Suspect" },
  { kind: "takeover", name: "Takeover" },
  { kind: "task", name: "Task" },
  { kind: "theft", name: "Theft" },
  { kind: "ticket", name: "Ticket" },
  { kind: "tide", name: "Tide" },
  { kind: "time", name: "Time" },
  { kind: "tower", name: "Tower" },
  { kind: "training", name: "Training" },
  { kind: "trap", name: "Trap" },
  { kind: "treasure", name: "Treasure" },
  { kind: "unity", name: "Unity" },
  { kind: "unlock", name: "Unlock" },
  { kind: "valor", name: "Valor" },
  { kind: "velocity", name: "Velocity" },
  { kind: "verse", name: "Verse" },
  { kind: "vitality", name: "Vitality" },
  { kind: "void", name: "Void" },
  { kind: "volatile", name: "Volatile" },
  { kind: "vortex", name: "Vortex" },
  { kind: "vow", name: "Vow" },
  { kind: "voyage", name: "Voyage" },
  { kind: "wage", name: "Wage" },
  { kind: "winch", name: "Winch" },
  { kind: "wind", name: "Wind" },
  { kind: "wish", name: "Wish" },
];

const COUNTER_CATALOG = [
  ...POWER_COUNTERS.map((entry) => ({ ...entry, category: "power" })),
  ...KEYWORD_COUNTERS.map((entry) => ({ ...entry, category: "keyword" })),
  ...NAMED_COUNTERS.map((entry) => ({ ...entry, category: "named" })),
];

const COUNTERS_BY_KIND = new Map(COUNTER_CATALOG.map((entry) => [entry.kind, entry]));

/** Parses "+1/+1" or "-2/-0" into the stat change it represents. */
function powerCounterDelta(kind) {
  const match = /^([+-]\d+)\/([+-]\d+)$/.exec(kind);
  return match ? { power: Number(match[1]), toughness: Number(match[2]) } : null;
}

/**
 * The counters a given card actually has anything to do with.
 *
 * A card that never mentions charge counters has no business offering them, so
 * during play the picker is narrowed to what the card itself talks about: any
 * "<name> counter" in its text, plus loyalty on a planeswalker, which is
 * universal and therefore never printed.
 *
 * Edit mode ignores this — an author building a puzzle may put anything
 * anywhere.
 */
function countersReferencedBy({ oracleText = "", typeLine = "" } = {}) {
  const text = String(oracleText).toLowerCase();
  const kinds = new Set();
  if (/planeswalker/i.test(typeLine)) kinds.add("loyalty");
  COUNTER_CATALOG.forEach((entry) => {
    // Matching "<name> counter" rather than the bare name keeps "shield" the
    // counter apart from "shield" the word, and "level" from "level up".
    const name = entry.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`${name}\\s+counters?\\b`).test(text)) kinds.add(entry.kind);
  });
  return COUNTER_CATALOG.filter((entry) => kinds.has(entry.kind));
}

const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Counter names as a regex alternation, longest first so that "first strike"
 * wins over "first" and "+1/+1" is never read as "+1".
 */
const KIND_ALTERNATION = COUNTER_CATALOG
  .map((entry) => entry.name)
  .sort((left, right) => right.length - left.length)
  .map(escapeForRegExp)
  .join("|");

const NAME_TO_KIND = new Map(COUNTER_CATALOG.map((entry) => [entry.name.toLowerCase(), entry.kind]));

const AMOUNT_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

// "X" is absent on purpose. By the time an ability resolves the board has
// already rewritten X as a number (see textWithXResolved in app.js), so a
// literal X reaching here means its value was never established — and placing
// a guessed number of counters would be worse than placing none.
const COUNTER_INSTRUCTION = new RegExp(
  String.raw`\b(puts?|removes?)\s+` +
  String.raw`(${Object.keys(AMOUNT_WORDS).join("|")}|\d+)\s+` +
  `(${KIND_ALTERNATION})` +
  String.raw`\s+counters?\s+(on|from)\s+([^.;\n]*)`,
  "gi",
);

/**
 * Reads every "put N <kind> counters on <subject>" and its "remove ... from"
 * mirror out of an ability's text. The subject is returned as written; working
 * out which permanents it means needs the board, so the caller does that.
 */
function parseCounterInstructions(text) {
  const instructions = [];
  String(text || "").replace(COUNTER_INSTRUCTION, (_match, verb, amount, kindName, preposition, subject) => {
    const kind = NAME_TO_KIND.get(String(kindName).toLowerCase());
    if (!kind) return _match;
    // Only this clause is ours. "Put a burden counter on The One Ring, then
    // draw a card for each burden counter on it" has a "for each" that belongs
    // to the draw, not to the counter — reading it as a multiplier would scale
    // the counter by a count that starts at zero, so none would ever be placed.
    const clause = String(subject).split(/,|\bthen\b/i)[0];
    // What remains is a subject plus, possibly, its own multiplier.
    const [rawSubject, ...forEachParts] = clause.split(/\bfor each\b/i);
    instructions.push({
      action: /^remove/i.test(verb) || preposition.toLowerCase() === "from" ? "remove" : "put",
      kind,
      amount: Number(amount) || AMOUNT_WORDS[String(amount).toLowerCase()] || 1,
      subject: rawSubject.trim().toLowerCase(),
      forEach: forEachParts.length ? forEachParts.join("for each").trim().toLowerCase() : null,
    });
    return _match;
  });
  return instructions;
}

/**
 * "This creature enters with three +1/+1 counters on it."
 *
 * A replacement effect, not a trigger: the permanent is never on the
 * battlefield without them, so the caller places these before it arrives.
 */
const ENTERS_WITH_COUNTERS = new RegExp(
  String.raw`\benters?\b(?:\s+the\s+battlefield)?[^.]*?\bwith\s+` +
  String.raw`(${Object.keys(AMOUNT_WORDS).join("|")}|\d+)\s+` +
  `(${KIND_ALTERNATION})` +
  String.raw`\s+counters?\b`,
  "i",
);

function entersWithCounters(oracleText) {
  return String(oracleText || "").split("\n").flatMap((line) => {
    const trimmed = line.trim();
    // "Whenever a creature enters with a +1/+1 counter on it" is a trigger that
    // happens to contain the same words. Only the card's own static wording
    // describes how *it* enters.
    if (/^(when|whenever|at)\b/i.test(trimmed)) return [];
    const match = ENTERS_WITH_COUNTERS.exec(trimmed);
    if (!match) return [];
    const kind = NAME_TO_KIND.get(String(match[2]).toLowerCase());
    if (!kind) return [];
    return [{ kind, amount: Number(match[1]) || AMOUNT_WORDS[String(match[1]).toLowerCase()] || 1 }];
  });
}

window.CounterCatalog = {
  all: COUNTER_CATALOG,
  countersReferencedBy,
  parseCounterInstructions,
  entersWithCounters,
  byKind: (kind) => COUNTERS_BY_KIND.get(kind) || null,
  label: (kind) => COUNTERS_BY_KIND.get(kind)?.name || kind,
  categoryOf: (kind) => COUNTERS_BY_KIND.get(kind)?.category || "named",
  powerCounterDelta,
  /** Case-insensitive substring match over the catalog, best prefixes first. */
  search(term) {
    const needle = String(term || "").trim().toLowerCase();
    if (!needle) return COUNTER_CATALOG;
    const hits = COUNTER_CATALOG.filter((entry) => entry.name.toLowerCase().includes(needle)
      || entry.kind.toLowerCase().includes(needle));
    return hits.sort((left, right) => {
      const leftStarts = left.name.toLowerCase().startsWith(needle) ? 0 : 1;
      const rightStarts = right.name.toLowerCase().startsWith(needle) ? 0 : 1;
      return leftStarts - rightStarts || left.name.localeCompare(right.name);
    });
  },
};
