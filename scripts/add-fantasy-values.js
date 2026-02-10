#!/usr/bin/env node
/**
 * Adds fantasyValueM field (4.0–12.0) based on marketValueEur.
 *
 * Input JSON shape (array):
 * [
 *   { "name": "...", "position": "...", "marketValueEur": 600000 },
 *   { "name": "...", "position": "...", "marketValueEur": null }
 * ]
 *
 * Usage:
 *   node scripts/add-fantasy-values.js market-values.json players-with-fantasy.json
 *
 * If output path is omitted, overwrites input file.
 */

const fs = require("fs");
const path = require("path");

const MIN_FANTASY = 4.0;
const MAX_FANTASY = 12.0;

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || inputPath;

  if (!inputPath) {
    console.error("Usage: node scripts/add-fantasy-values.js <input.json> [output.json]");
    process.exit(1);
  }

  const absIn = path.resolve(process.cwd(), inputPath);
  const absOut = path.resolve(process.cwd(), outputPath);

  const raw = fs.readFileSync(absIn, "utf8");
  const data = JSON.parse(raw);

  if (!Array.isArray(data)) {
    throw new Error("Input JSON must be an array of players");
  }

  // Collect valid market values
  const values = data
    .map(p => p?.marketValueEur)
    .filter(v => typeof v === "number" && Number.isFinite(v) && v > 0);

  const minMV = values.length ? Math.min(...values) : 0;
  const maxMV = values.length ? Math.max(...values) : 0;

  const mapped = data.map((p) => {
    const mv = p?.marketValueEur;

    let fantasyValueM = MIN_FANTASY;

    if (typeof mv === "number" && Number.isFinite(mv) && mv > 0 && maxMV > minMV) {
      // min-max scaling to [MIN_FANTASY, MAX_FANTASY]
      const t = (mv - minMV) / (maxMV - minMV); // 0..1
      fantasyValueM = MIN_FANTASY + t * (MAX_FANTASY - MIN_FANTASY);
    } else if (typeof mv === "number" && Number.isFinite(mv) && mv > 0 && maxMV === minMV) {
      // edge case: everyone has same value
      fantasyValueM = (MIN_FANTASY + MAX_FANTASY) / 2;
    } else {
      // mv missing => keep minimum
      fantasyValueM = MIN_FANTASY;
    }

    fantasyValueM = round1(clamp(fantasyValueM, MIN_FANTASY, MAX_FANTASY));

    return {
      ...p,
      fantasyValueM
    };
  });

  fs.writeFileSync(absOut, JSON.stringify(mapped, null, 2), "utf8");
  console.log(`Wrote ${mapped.length} players -> ${absOut}`);
  console.log(`Market value range used: min=${minMV} max=${maxMV} (EUR)`);
}

main();
