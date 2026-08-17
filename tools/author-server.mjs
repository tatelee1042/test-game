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
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUZZLE_DIR = path.join(ROOT, "puzzles");
const INDEX_FILE = path.join(PUZZLE_DIR, "index.json");
/** The same folder as a git pathspec: repo-relative, never an absolute path. */
const PUZZLE_PATHSPEC = "puzzles";
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

/* ---------------------------------------------------------------------------
 * Shipping puzzles to the live site
 *
 * The deployed board is whatever sits in puzzles/ on the default branch, so
 * "go live" is precisely a commit and a push. Doing it from the board saves a
 * trip to the terminal for what is otherwise the same two commands.
 *
 * Only puzzles/ is ever staged. Work in progress elsewhere in the tree — a
 * half-finished change to app.js, say — must never be swept live by a button
 * whose label only promises to publish a puzzle.
 * ------------------------------------------------------------------------- */

const execFileAsync = promisify(execFile);

/**
 * Runs git directly, never through a shell, so nothing the browser sends can be
 * interpolated into a command. Git writes its real complaint to stderr, which is
 * the part worth showing the author.
 */
async function gitRaw(...args) {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd: ROOT, maxBuffer: 4 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    throw new Error(String(error.stderr || error.message).trim());
  }
}

/** For the single-value queries. Porcelain output must go through gitRaw: its
    leading column is significant whitespace that trimming would eat. */
async function git(...args) {
  return (await gitRaw(...args)).trim();
}

/** What is waiting to go live, and how this branch stands against its remote. */
async function gitStatus() {
  const branch = await git("rev-parse", "--abbrev-ref", "HEAD");
  let upstream = "";
  try {
    upstream = await git("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}");
  } catch (_error) {
    // No upstream set: reported to the author rather than guessed at.
  }

  // "XY path", where X and Y are one column each and may be spaces.
  const porcelain = await gitRaw("status", "--porcelain", "--", PUZZLE_PATHSPEC);
  const pending = porcelain.split("\n").filter(Boolean).map((line) => ({
    state: line.slice(0, 2).trim(),
    // A rename reads "old -> new"; the destination is the one that matters.
    path: line.slice(3).split(" -> ").pop().replace(/^"|"$/g, ""),
  }));

  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = await git("rev-list", "--left-right", "--count", `${upstream}...HEAD`);
    [behind, ahead] = counts.split(/\s+/).map(Number);
  }
  return { branch, upstream, pending, ahead, behind };
}

async function publishLive(message) {
  const status = await gitStatus();
  if (!status.upstream) {
    throw new Error(`${status.branch} has no upstream branch. Set one with: git push -u origin ${status.branch}`);
  }
  // A push would be rejected anyway; saying why beats surfacing git's wall of text.
  if (status.behind > 0) {
    throw new Error(
      `${status.branch} is ${status.behind} commit${status.behind === 1 ? "" : "s"} behind ${status.upstream}. ` +
      `Run git pull --rebase first, then publish again.`,
    );
  }

  let commit = null;
  if (status.pending.length) {
    await git("add", "--", PUZZLE_PATHSPEC);
    const staged = await git("diff", "--cached", "--name-only", "--", PUZZLE_PATHSPEC);
    if (staged) {
      await git("commit", "-m", String(message || "").trim() || "Update puzzles");
      commit = await git("rev-parse", "--short", "HEAD");
    }
  }

  const ahead = commit ? status.ahead + 1 : status.ahead;
  if (!ahead) return { commit: null, pushed: false, detail: "Nothing to publish — the live site already matches." };

  await git("push", "origin", status.branch);
  return {
    commit,
    pushed: true,
    detail: commit
      ? `Committed ${commit} and pushed to ${status.upstream}.`
      : `Pushed ${ahead} waiting commit${ahead === 1 ? "" : "s"} to ${status.upstream}.`,
  };
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

  if (pathname === "/api/git/status" && request.method === "GET") {
    try {
      return json(response, 200, await gitStatus());
    } catch (error) {
      return json(response, 400, { error: error.message });
    }
  }

  if (pathname === "/api/git/publish" && request.method === "POST") {
    let raw = "";
    request.on("data", (chunk) => { raw += chunk; });
    request.on("end", async () => {
      try {
        const { message } = JSON.parse(raw || "{}");
        const result = await publishLive(message);
        console.log(`  live       ${result.detail}`);
        json(response, 200, result);
      } catch (error) {
        console.log(`  failed     ${error.message.split("\n")[0]}`);
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

// Bound to the loopback address on purpose. These endpoints write files and run
// git against this checkout, which is nobody else's business on a shared network.
server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  Daily Spellbook — authoring\n`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Edit board -> build a puzzle -> Publish puzzle.`);
  console.log(`  Then Push live to commit puzzles/ and push it to the remote.\n`);
});
