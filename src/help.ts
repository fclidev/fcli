import { type Uck } from "./types.js";

export function help(ucks: Uck[], fVersion: string): string {
  // One column of names, one column of descs (clamped by the loader). Sort
  // by name for stable, greppable output.
  const lines = [...ucks]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((u) => `  ${u.name}  ${u.desc ?? ""}`);
  return `f v${fVersion} — token-efficient CLI

usage: f <uck> [args]

ucks:
${lines.join("\n")}

run 'f <uck> --help' for details.`;
}
