/**
 * Puzzle storage adapter.
 *
 * The game never talks to a backend directly — it goes through window.PuzzleStore.
 * Today that store is a folder of JSON files committed to the repo: the published
 * site fetches them read-only, and the only thing that can write them is the local
 * authoring server in tools/author-server.mjs, which never gets deployed. That is
 * what makes the published board genuinely read-only; a visitor forcing edit mode
 * in devtools is only ever editing their own copy of the page.
 *
 * Swapping this for a hosted database later means writing one new adapter with the
 * same five methods and leaving the rest of the game untouched. The committed JSON
 * files double as the migration source.
 */

const PUZZLE_DIR = "puzzles";
const INDEX_URL = `${PUZZLE_DIR}/index.json`;
const AUTHORING_PROBE_URL = "api/authoring";

/** Today in the visitor's own timezone, as YYYY-MM-DD. */
function today() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

async function readJson(url) {
  const response = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

const PuzzleStore = {
  /** True once the local authoring server has answered; false on the live site. */
  authoringAvailable: false,

  /**
   * Authoring exists only where the write API does. On GitHub Pages this request
   * 404s and the edit controls stay out of the page entirely.
   */
  async detectAuthoring() {
    try {
      const response = await fetch(AUTHORING_PROBE_URL, { cache: "no-store" });
      this.authoringAvailable = response.ok && (await response.json())?.authoring === true;
    } catch (_error) {
      this.authoringAvailable = false;
    }
    return this.authoringAvailable;
  },

  /**
   * Every published puzzle, newest date first. Entries are manifest records
   * ({ id, title, date, seats, cardCount }), not whole boards, so the archive can
   * list puzzles without fetching each one.
   */
  async listPuzzles() {
    let entries;
    try {
      entries = await readJson(INDEX_URL);
    } catch (_error) {
      // No puzzles published yet — an empty shelf, not an error.
      return [];
    }
    if (!Array.isArray(entries)) return [];
    return entries
      .filter((entry) => entry && entry.id)
      .sort((left, right) => String(right.date).localeCompare(String(left.date)));
  },

  /** Puzzles a visitor is allowed to see: dated today or earlier. */
  async listReleasedPuzzles() {
    const now = today();
    return (await this.listPuzzles()).filter((entry) => String(entry.date) <= now);
  },

  /**
   * The puzzle for today, or the most recent one before today if nothing is
   * scheduled for it. Null when nothing has been published at all.
   */
  async getDailyPuzzle() {
    const released = await this.listReleasedPuzzles();
    const now = today();
    return released.find((entry) => entry.date === now) || released[0] || null;
  },

  /** The full saved board for one puzzle, or null if it is missing. */
  async getPuzzle(id) {
    if (!id) return null;
    try {
      return await readJson(`${PUZZLE_DIR}/${encodeURIComponent(id)}.json`);
    } catch (_error) {
      return null;
    }
  },

  /**
   * Writes a puzzle through the authoring server. Only ever reachable while
   * authoring locally; the published site has no endpoint behind this.
   */
  async savePuzzle(record) {
    const response = await fetch("api/puzzles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not save (${response.status}).`);
    return payload;
  },

  /**
   * What is staged to go live: pending puzzle files, and how this branch stands
   * against its remote. Authoring only — there is no git on the deployed site.
   */
  async gitStatus() {
    const response = await fetch("api/git/status", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not read git status (${response.status}).`);
    return payload;
  },

  /** Commits puzzles/ and pushes it, which is what putting a puzzle live means. */
  async publishLive(message) {
    const response = await fetch("api/git/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not publish (${response.status}).`);
    return payload;
  },

  async deletePuzzle(id) {
    const response = await fetch(`api/puzzles/${encodeURIComponent(id)}`, { method: "DELETE" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Could not delete (${response.status}).`);
    return payload;
  },

  today,
};

window.PuzzleStore = PuzzleStore;
