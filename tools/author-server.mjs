/**
 * Local authoring server.
 *
 * Serves the board and exposes the write API that publishes puzzles into the
 * puzzles/ folder. This file is deliberately never deployed — the live site is
 * plain static hosting with no endpoint behind PuzzleStore.savePuzzle, which is
 * what makes the published puzzles read-only for everyone but you.
 *
 *   npm run author      then open http://localhost:8765
 *
 * Publish a puzzle, then commit and push puzzles/ to put it live.
 */

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUZZLE_DIR = path.join(ROOT, "puzzles");
const INDEX_FILE = path.join(PUZZLE_DIR, "index.json");
const PORT = Number(process.env.PORT) || 8765;

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const json = (response, status, body) => {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
};

/** Puzzle ids become filenames, so keep them to something safe and predictable. */
function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function readIndex() {
  try {
    const raw = await fs.readFile(INDEX_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return [];
  }
}

async function writeIndex(entries) {
  entries.sort((left, right) => String(right.date).localeCompare(String(left.date)));
  await fs.mkdir(PUZZLE_DIR, { recursive: true });
  await fs.writeFile(INDEX_FILE, `${JSON.stringify(entries, null, 2)}\n`);
}

function countCards(state) {
  return Object.values(state?.zones || {}).reduce((total, cards) => total + cards.length, 0);
}

async function publishPuzzle(record) {
  const title = String(record?.title || "").trim();
  const date = String(record?.date || "").trim();
  if (!title) throw new Error("A puzzle needs a title.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A puzzle needs a date as YYYY-MM-DD.");
  if (!record?.state?.zones) throw new Error("That board could not be captured.");

  // Editing an existing puzzle keeps its id so its URL stays valid.
  const id = record.id ? slugify(record.id) : `${date}-${slugify(title)}`;
  if (!id) throw new Error("That title has no characters usable in a filename.");

  await fs.mkdir(PUZZLE_DIR, { recursive: true });
  const puzzle = {
    id,
    title,
    date,
    notes: String(record.notes || "").trim(),
    // Shown in a popup when a player opens the puzzle. Empty means no popup.
    instructions: String(record.instructions || "").trim(),
    state: record.state,
  };
  await fs.writeFile(path.join(PUZZLE_DIR, `${id}.json`), `${JSON.stringify(puzzle, null, 2)}\n`);

  const entries = await readIndex();
  const entry = {
    id,
    title,
    date,
    seats: 1 + (record.state.aiSeats?.length || 1),
    cardCount: countCards(record.state),
    publishedAt: new Date().toISOString(),
  };
  const existing = entries.findIndex((candidate) => candidate.id === id);
  if (existing >= 0) entries[existing] = entry;
  else entries.push(entry);
  await writeIndex(entries);
  return entry;
}

async function deletePuzzle(id) {
  const safeId = slugify(id);
  if (!safeId) throw new Error("Unknown puzzle.");
  await fs.rm(path.join(PUZZLE_DIR, `${safeId}.json`), { force: true });
  await writeIndex((await readIndex()).filter((entry) => entry.id !== safeId));
  return { id: safeId };
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.join(ROOT, relative);
  // Never serve anything outside the project directory.
  if (!filePath.startsWith(ROOT)) return json(response, 403, { error: "Forbidden" });
  try {
    const body = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch (_error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const { pathname } = url;

  // Tells the page that authoring is available. Absent on the deployed site.
  if (pathname === "/api/authoring") return json(response, 200, { authoring: true });

  if (pathname === "/api/puzzles" && request.method === "POST") {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", async () => {
      try {
        const entry = await publishPuzzle(JSON.parse(raw));
        console.log(`  published  ${entry.date}  ${entry.title}  (puzzles/${entry.id}.json)`);
        json(response, 200, entry);
      } catch (error) {
        json(response, 400, { error: error.message });
      }
    });
    return undefined;
  }

  if (pathname.startsWith("/api/puzzles/") && request.method === "DELETE") {
    try {
      const removed = await deletePuzzle(decodeURIComponent(pathname.slice("/api/puzzles/".length)));
      console.log(`  removed    puzzles/${removed.id}.json`);
      return json(response, 200, removed);
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }

  return serveStatic(request, response, pathname);
});

server.listen(PORT, () => {
  console.log(`\n  Daily Spellbook — authoring\n`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Edit board -> build a puzzle -> Publish puzzle.`);
  console.log(`  Then commit and push puzzles/ to put it live.\n`);
});
