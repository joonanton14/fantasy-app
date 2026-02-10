#!/usr/bin/env node
/**
 * Parse Transfermarkt-like copied text into JSON:
 * - name
 * - position
 * - marketValueEur (number | null)
 *
 * Usage:
 *   node scripts/parse-transfermarkt-text.js input.txt output.json
 *
 * Example:
 *   node scripts/parse-transfermarkt-text.js hjk.txt market-values.json
 */

const fs = require("fs");
const path = require("path");

function parseMoneyToEur(token) {
  // token examples: "€50k", "€600k", "€1.2m", "-"
  token = token.trim();
  if (token === "-" || token === "€-" || token === "") return null;

  // common formats: €50k, €600k, €1.2m, €1m
  const m = token.match(/^€\s*([\d.,]+)\s*([km])$/i);
  if (!m) return null;

  const num = parseFloat(m[1].replace(",", "."));
  const unit = m[2].toLowerCase();
  if (Number.isNaN(num)) return null;

  if (unit === "k") return Math.round(num * 1_000);
  if (unit === "m") return Math.round(num * 1_000_000);
  return null;
}

function isDateLine(s) {
  // dd/mm/yyyy
  return /^\d{2}\/\d{2}\/\d{4}$/.test(s.trim());
}

function isMoneyLine(s) {
  s = s.trim();
  return s === "-" || /^€\s*[\d.,]+\s*[km]$/i.test(s);
}

function isLikelyPosition(s) {
  // Common Transfermarkt position strings (leave flexible)
  const t = s.trim();
  if (!t) return false;
  // Avoid obvious non-position lines
  if (isDateLine(t) || isMoneyLine(t)) return false;
  if (/^\d+$/.test(t)) return false; // shirt number etc.
  if (t.includes("\t")) return false;
  if (t.length > 40) return false;

  // Common keywords
  const keywords = [
    "keeper", "goalkeeper",
    "back", "centre-back", "center-back",
    "midfield", "wing", "winger",
    "striker", "forward", "centre-forward", "center-forward",
    "attacking", "defensive",
    "left", "right", "second"
  ];
  const lower = t.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

function normalizeWhitespace(text) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function parseBlocks(text) {
  // Parse space-separated Transfermarkt data in format:
  // FirstName LastName FirstName LastName Position Age Country ... Date MarketValue ...
  //
  // Pattern: name appears twice (first+last, first+last), then position
  
  const tokens = text.split(/\s+/).filter(t => t);
  const players = [];
  let i = 0;

  while (i < tokens.length) {
    // Look for repeated names: token[i] token[i+1] token[i] token[i+1]
    // followed by a position keyword
    if (i + 4 >= tokens.length) break;

    const name1_first = tokens[i];
    const name1_last = tokens[i + 1];
    const name2_first = tokens[i + 2];
    const name2_last = tokens[i + 3];
    const posCandidate = tokens[i + 4];

    // Check if name repeats and position is valid
    if (name1_first === name2_first && name1_last === name2_last && isLikelyPosition(posCandidate)) {
      const fullName = `${name1_first} ${name1_last}`;
      const position = posCandidate;

      // Scan forward to find market value
      let marketValueEur = null;
      let k = i + 5;
      while (k < tokens.length && k < i + 20) {
        if (isMoneyLine(tokens[k])) {
          marketValueEur = parseMoneyToEur(tokens[k]);
          break;
        }
        // If we hit another position keyword far enough ahead, we've gone too far
        if (k > i + 8 && isLikelyPosition(tokens[k])) {
          break;
        }
        k++;
      }

      players.push({
        name: fullName,
        position,
        marketValueEur
      });

      i += 4;
    } else {
      i++;
    }
  }

  // de-duplicate by name
  const seen = new Set();
  const deduped = [];
  for (const p of players) {
    const key = p.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }

  return deduped;
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || "market-values.json";

  if (!inputPath) {
    console.error("Usage: node scripts/parse-transfermarkt-text.js input.txt output.json");
    process.exit(1);
  }

  const absIn = path.resolve(process.cwd(), inputPath);
  const absOut = path.resolve(process.cwd(), outputPath);

  const raw = fs.readFileSync(absIn, "utf8");
  const text = normalizeWhitespace(raw);

  const players = parseBlocks(text);

  fs.writeFileSync(absOut, JSON.stringify(players, null, 2), "utf8");
  console.log(`Wrote ${players.length} players -> ${absOut}`);
}

main();
