import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve("docs/game-asset-catalog.json");
const catalog = JSON.parse(readFileSync(path, "utf8"));
const tiers = new Set(["clear", "verify", "restricted"]);
const ids = new Set();

if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) {
  throw new Error("catalog.entries must be a non-empty array");
}

for (const entry of catalog.entries) {
  for (const field of ["id", "name", "kind", "license", "tier", "source", "recommendedFor"]) {
    if (!entry[field] || (Array.isArray(entry[field]) && entry[field].length === 0)) {
      throw new Error(`${entry.id ?? "unknown"}: missing ${field}`);
    }
  }
  if (ids.has(entry.id)) throw new Error(`duplicate id: ${entry.id}`);
  if (!tiers.has(entry.tier)) throw new Error(`${entry.id}: invalid tier ${entry.tier}`);
  if (!entry.source.startsWith("https://")) throw new Error(`${entry.id}: source must use HTTPS`);
  ids.add(entry.id);
}

console.log(`Validated ${catalog.entries.length} game asset entries.`);
