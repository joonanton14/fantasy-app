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
const MAX_FANTASY = 14.0;

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

  // Use global market value range across all players
  const GLOBAL_MIN_MV = 0;
  const GLOBAL_MAX_MV = 600000;

  const mapped = data.map((p) => {
    const mv = p?.marketValueEur;

    let fantasyValueM = MIN_FANTASY;

    if (typeof mv === "number" && Number.isFinite(mv) && mv > 0) {
      // Global min-max scaling to [MIN_FANTASY, MAX_FANTASY]
      // 0 EUR → 4.0, 600k EUR → 14.0
      const t = (mv - GLOBAL_MIN_MV) / (GLOBAL_MAX_MV - GLOBAL_MIN_MV); // 0..1
      fantasyValueM = MIN_FANTASY + t * (MAX_FANTASY - MIN_FANTASY);
    } else {
      // mv missing or zero => keep minimum
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
  console.log(`Using global market value range: min=${GLOBAL_MIN_MV} max=${GLOBAL_MAX_MV} (EUR)`);
}

main();
