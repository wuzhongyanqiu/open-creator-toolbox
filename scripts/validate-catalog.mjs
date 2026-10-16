import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tiers = new Set(["clear", "verify", "restricted"]);
const localStatuses = new Set(["installed", "not-installed"]);

for (const file of ["docs/game-asset-catalog.json", "docs/game-toolkit-catalog.json"]) {
  const catalog = JSON.parse(readFileSync(resolve(file), "utf8"));
  const ids = new Set();

  if (!Array.isArray(catalog.entries) || catalog.entries.length === 0) {
    throw new Error(`${file}: entries must be a non-empty array`);
  }

  for (const entry of catalog.entries) {
    for (const field of ["id", "name", "kind", "license", "tier", "source", "recommendedFor"]) {
      if (!entry[field] || (Array.isArray(entry[field]) && entry[field].length === 0)) {
        throw new Error(`${file} ${entry.id ?? "unknown"}: missing ${field}`);
      }
    }
    if (ids.has(entry.id)) throw new Error(`${file}: duplicate id: ${entry.id}`);
    if (!tiers.has(entry.tier)) throw new Error(`${file} ${entry.id}: invalid tier ${entry.tier}`);
    if (!entry.source.startsWith("https://")) throw new Error(`${file} ${entry.id}: source must use HTTPS`);
    if (catalog.categories && !catalog.categories[entry.category]) throw new Error(`${file} ${entry.id}: unknown category ${entry.category}`);
    if (entry.localStatus && !localStatuses.has(entry.localStatus)) throw new Error(`${file} ${entry.id}: invalid localStatus ${entry.localStatus}`);
    ids.add(entry.id);
  }

  console.log(`Validated ${catalog.entries.length} entries in ${file}.`);
}
