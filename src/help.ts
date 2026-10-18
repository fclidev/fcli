import { type Uck } from "./types.js";

/** Names only, in sorted columns. This is the whole default `f` output: enough
 *  to learn that a command exists, nothing else. Descriptions are deliberately
 *  absent — a full name+desc listing grows linearly with the store (measured:
 *  ~21 tokens per uck, so 60 ucks costs ~1,300), and the model rarely needs
 *  every description at once. Get one with `f <uck> --help`, or a filtered set
 *  from the `search` uck.
 *
 *  The hint names `search` even though it is a uck and not core: if the store is
 *  empty the hint points at a command that is not there. That is acceptable for
 *  a hint and not for a behaviour — core never routes to `search`, so an absent
 *  uck gives f's normal "unknown uck" error rather than a wrong answer. */
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
