import { type Uck } from "./types.js";

/** Names only, in sorted columns. This is the whole default `f` output: enough
 *  to learn that a command exists, nothing else. Descriptions are deliberately
 *  absent — a full name+desc listing grows linearly with the store (measured:
 *  ~21 tokens per uck, so 60 ucks costs ~1,300), and the model rarely needs
 *  every description at once. Get one with `f <uck> --help`, or a filtered set
 *  with `f search <query>`. */
export function helpNames(ucks: Uck[], fVersion: string): string {
  const names = [...ucks].map((u) => u.name).sort();
  return `f v${fVersion}\n\n${columnize(names)}\n\nf <uck> --help | f search <query>\n`;
}

/** Greedy left-to-right packing into a fixed-width grid: fill column by column
 *  so the result stays greppable and every column starts at the same offset.
 *  Column width is max name length + 2, which keeps short names cheap without
 *  letting one long name stretch the whole grid. */
function columnize(words: string[], maxWidth = 76): string {
  if (!words.length) return "";
  const width = Math.max(...words.map((w) => w.length)) + 2;
  const cols = Math.max(
    1,
    Math.min(words.length, Math.floor(maxWidth / width)),
  );
  const rows = Math.ceil(words.length / cols);
  const cells: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = c * rows + r; // column-major: down each column, then next
      if (i < words.length) cells.push(words[i]!.padEnd(width));
    }
    cells.push("\n");
    // last cell of the last row is a trailing newline; trim below
  }
  return cells.join("").replace(/\s+$/, "");
}

/** One match per line: `name  desc`. Only for `f search`, which pays for
 *  descriptions on the few ucks that matched rather than on all of them. */
export function searchMatches(
  ucks: Uck[],
  query: string,
): { name: string; desc: string; score: number; byName: boolean }[] {
  const terms = tokenize(query);
  if (!terms.length) return [];
  const out: { name: string; desc: string; score: number; byName: boolean }[] =
    [];
  for (const u of ucks) {
    const score = scoreUck(u, terms);
    if (score > 0)
      out.push({
        name: u.name,
        desc: clampSearchDesc(u.desc ?? ""),
        score,
        byName: score >= 100,
      });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

const WORD = /[^a-z0-9]+/;

/**
 * Search output caps descriptions far harder than `f help` ever did (DESC_MAX,
 * 120). Search returns several lines at once and each one pays for its own
 * description, so per-line cost is what the model actually feels: measured on
 * three matches, 120 chars costs 84 tokens, 40 costs 49, 30 costs 34. A hit is
 * meant to be a pointer to `f <uck> --help`, not a substitute for it.
 */
export const SEARCH_DESC_MAX = 40;

function clampSearchDesc(desc: string): string {
  const one = String(desc ?? "")
    .split("\n")[0]
    .trim();
  if (one.length <= SEARCH_DESC_MAX) return one;
  // Prefer to cut at a word boundary: "store credentials (scrypt+AES-GCM,…"
  // reads as a label, whereas a mid-word cut reads as corruption.
  const cut = one.slice(0, SEARCH_DESC_MAX - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > SEARCH_DESC_MAX / 2 ? cut.slice(0, sp) : cut) + "…";
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(WORD)
    .filter((t) => t.length > 1); // drop 1-char noise: "f", "a", path fragments
}

/**
 * Scoring is substring matching, not fuzzy and not semantic, and that is the
 * point: the model can predict what will match. Weights, highest first —
 *   exact name            a whole term IS the uck name
 *   name prefix / word    a term starts a name-word, or is one
 *   name substring          a term appears inside a name-word
 *   desc word / substring  weaker still; descriptions are longer text
 * A hyphenated name (`pi-models`) counts as two words, so "models" finds it.
 *
 * A uck matched purely on its description has not been named — it is a guess —
 * so it is listed after every name hit and under a marker. See searchMatches.
 */
function scoreUck(u: Uck, terms: string[]): number {
  const nameWords = u.name.toLowerCase().split(WORD).filter(Boolean);
  const descWords = (u.desc ?? "").toLowerCase().split(WORD).filter(Boolean);
  const name = u.name.toLowerCase();
  const desc = (u.desc ?? "").toLowerCase();
  let score = 0;
  let named = false; // matched on the name itself, not only the description
  for (const t of terms) {
    if (name === t) {
      score += 8;
      named = true;
    } else if (nameWords.some((w) => w === t)) {
      score += 6;
      named = true;
    } else if (nameWords.some((w) => w.startsWith(t))) {
      score += 4;
      named = true;
    } else if (name.includes(t)) {
      score += 3;
      named = true;
    } else if (descWords.some((w) => w === t)) score += 2;
    else if (descWords.some((w) => w.startsWith(t))) score += 1.5;
    else if (desc.includes(t)) score += 1;
  }
  return named ? score + 100 : score; // name hits sort ahead of desc-only hits
}

export function searchUsage(): string {
  return `usage: f search <query>

  ranks installed ucks by name, then by description.
  matches on substrings and word prefixes, not meaning.

  e.g. f search credential
       f search "list files"
`;
}
