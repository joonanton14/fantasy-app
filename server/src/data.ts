import fs from 'fs';
import path from 'path';
import { Player, Team, Fixture, Position } from './models';

export const teams: Team[] = [
  { id: 1, name: 'HJK' },
  { id: 2, name: 'Inter' },
  { id: 3, name: 'KuPS' },
  { id: 4, name: 'VPS' },
  { id: 5, name: 'Lahti' },
  { id: 6, name: 'SJK' },
  { id: 7, name: 'Ilves' },
  { id: 8, name: 'Gnistan' },
  { id: 9, name: 'AC Oulu' },
  { id: 10, name: 'Mifk' },
  { id: 11, name: 'Jaro' },
  { id: 12, name: 'TPS' }
];

export const players: Player[] = [];

function normalize(s: unknown): string {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mapPosition(raw: unknown): Position {
  const r = String(raw ?? '').toLowerCase();
  if (r.includes('goal')) return 'GK';
  if (r.includes('back') || r.includes('defender')) return 'DEF';
  if (r.includes('forward') || r.includes('striker') || r.includes('wing') || r.includes('winger')) return 'FWD';
  return 'MID';
}

function clampValue(v: number): number {
  if (!Number.isFinite(v) || Number.isNaN(v)) return 4;
  return Math.max(4, Math.min(12, Math.round(v)));
}

function detectTeamForFile(fileName: string, data: unknown[]): Team | undefined {
  const fileKey = normalize(fileName);

  // 1) Try to detect team from player objects (common fields)
  const candidateFields = ['team', 'club', 'teamName', 'clubName', 'team_name', 'club_name', 'teamname', 'clubname'];
  for (const item of data) {
    if (typeof item !== 'object' || item == null) continue;
    const obj = item as Record<string, unknown>;

    // If numeric teamId present, match by id
    const teamIdVal = obj.teamId ?? obj.team_id ?? obj.teamID;
    if (typeof teamIdVal === 'number') {
      const t = teams.find((tt) => tt.id === teamIdVal);
      if (t) return t;
    }

    // Try string fields
    for (const f of candidateFields) {
      const val = obj[f];
      if (typeof val === 'string' && val.trim()) {
        const norm = normalize(val);
        const t = teams.find((tt) => normalize(tt.name) === norm || norm.includes(normalize(tt.name)) || normalize(tt.name).includes(norm));
        if (t) return t;
      }
    }
  }

  // 2) Fallback to match by filename
  const byFile = teams.find((t) => fileKey.includes(normalize(t.name)));
  if (byFile) return byFile;

  // 3) Try partial tokens from filenames with best-match scoring
  const fileTokens = fileKey.split(/[^a-z0-9]+/).filter(Boolean);
  let bestMatch: Team | undefined;
  let bestScore = 0;

  // Try single tokens and consecutive token pairs
  for (let i = 0; i < fileTokens.length; i++) {
    const candidates = [
      fileTokens[i],
      i + 1 < fileTokens.length ? fileTokens[i] + fileTokens[i + 1] : null
    ].filter(Boolean) as string[];

    for (const token of candidates) {
      for (const team of teams) {
        const normTeamName = normalize(team.name);
        let score = 0;

        // Exact match is best
        if (normTeamName === token) score = 1000;
        // Team name fully contains token
        else if (normTeamName.includes(token)) score = 100 + normTeamName.length;
        // Token contains team name
        else if (token.includes(normTeamName)) score = 50 + normTeamName.length;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = team;
        }
      }
    }
  }

  return bestMatch;
}

(function loadPlayersFromDisk(): void {
  try {
    const playersDir = path.resolve(process.cwd(), 'players');
    if (!fs.existsSync(playersDir)) return;

    const files = fs.readdirSync(playersDir).filter((f) => f.endsWith('.json'));
    let nextId = 1;

    for (const file of files) {
      const rawText = fs.readFileSync(path.join(playersDir, file), 'utf8');
      let data: unknown;
      try {
        data = JSON.parse(rawText);
      } catch {
        continue;
      }
      if (!Array.isArray(data)) continue;

      const team = detectTeamForFile(file, data);
      const teamId = team ? team.id : 0;

      for (const item of data) {
        if (typeof item !== 'object' || item == null) continue;
        const p = item as Record<string, unknown>;
        const name = String(p.name ?? p.playerName ?? p.fullName ?? 'Unknown');
        const rawPos = p.position ?? p.role ?? p.positionName ?? '';
        const position = mapPosition(rawPos);
        const valueNum =
          (typeof p.fantasyValueM === 'number' && p.fantasyValueM) ||
          (typeof p.marketValueEur === 'number' && (p.marketValueEur as number) / 1_000_000) ||
          (typeof p.value === 'number' && (p.value as number)) ||
          4;

        players.push({
          id: nextId++,
          name,
          position,
          teamId,
          value: clampValue(Number(valueNum))
        });
      }
    }

    console.log(`Loaded ${players.length} players from ${path.resolve(__dirname, '..', '..', 'players')}`);
  } catch (err) {
    console.warn('Failed to load players from disk:', err);
  }
})();

// -------------------- REAL FIXTURES --------------------
// We store ISO-ish strings with explicit +03:00 offset (Finland spring/summer).
// This avoids JS Date timezone surprises on servers.

function toIsoEET(dateFi: string, time: string): string {
  // dateFi: "4.4.2026"
  const [d, m, y] = dateFi.split(".").map((x) => Number(x));
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  // Note: Veikkausliiga season is in summer time (+03:00) for these dates.
  return `${y}-${mm}-${dd}T${time}:00+03:00`;
}

// Map names from your schedule text -> your `teams` list names
const TEAM_ALIASES: Record<string, string> = {
  "FC Inter": "Inter",
  "Inter": "Inter",

  "FF Jaro": "Jaro",
  "Jaro": "Jaro",

  "IFK Mariehamn": "Mifk",
  "Mariehamn": "Mifk",
  "Mifk": "Mifk",

  "IF Gnistan": "Gnistan",
  "Gnistan": "Gnistan",

  "FC Lahti": "Lahti",
  "Lahti": "Lahti",

  "AC Oulu": "AC Oulu",

  "HJK": "HJK",
  "SJK": "SJK",
  "Ilves": "Ilves",
  "KuPS": "KuPS",
  "VPS": "VPS",
  "TPS": "TPS",
};

function teamIdByName(raw: string): number {
  const trimmed = String(raw ?? "").trim();
  const mapped = TEAM_ALIASES[trimmed] ?? trimmed;

  const t = teams.find((x) => normalize(x.name) === normalize(mapped));
  if (!t) {
    throw new Error(`Unknown team name in fixtures: "${raw}" (mapped to "${mapped}")`);
  }
  return t.id;
}

// Enter fixtures here as tuples: [id, "d.m.yyyy", "HH:mm", "Home", "Away"]
const FIXTURE_ROWS: Array<[number, string, string, string, string]> = [
  [1, "4.4.2026", "13:00", "FC Inter", "VPS"],
  [2, "4.4.2026", "15:00", "HJK", "SJK"],
  [3, "4.4.2026", "17:00", "FF Jaro", "FC Lahti"],
  [4, "4.4.2026", "17:00", "IFK Mariehamn", "TPS"],
  [5, "4.4.2026", "17:00", "Ilves", "KuPS"],
  [6, "4.4.2026", "19:00", "IF Gnistan", "AC Oulu"],

  [7, "10.4.2026", "18:00", "TPS", "FC Lahti"],
  [8, "10.4.2026", "19:00", "SJK", "IFK Mariehamn"],
  [9, "10.4.2026", "20:00", "VPS", "FF Jaro"],

  [10, "11.4.2026", "15:00", "KuPS", "IF Gnistan"],
  [11, "11.4.2026", "17:00", "HJK", "AC Oulu"],
  [12, "11.4.2026", "19:00", "FC Inter", "Ilves"],

  [13, "18.4.2026", "14:00", "IF Gnistan", "HJK"],
  [14, "18.4.2026", "16:00", "FF Jaro", "KuPS"],
  [15, "18.4.2026", "17:00", "AC Oulu", "VPS"],
  [16, "18.4.2026", "17:00", "FC Lahti", "FC Inter"],
  [17, "18.4.2026", "17:00", "TPS", "SJK"],
  [18, "18.4.2026", "19:00", "IFK Mariehamn", "Ilves"],

  [19, "22.4.2026", "18:00", "KuPS", "AC Oulu"],

  [20, "24.4.2026", "18:00", "TPS", "IF Gnistan"],
  [21, "24.4.2026", "18:00", "VPS", "Ilves"],
  [22, "24.4.2026", "19:00", "SJK", "FF Jaro"],

  [23, "25.4.2026", "15:00", "FC Lahti", "AC Oulu"],
  [24, "25.4.2026", "17:00", "FC Inter", "IFK Mariehamn"],

  [25, "26.4.2026", "16:00", "KuPS", "HJK"],

  [26, "29.4.2026", "19:00", "FC Inter", "HJK"],

  [27, "2.5.2026", "15:00", "SJK", "Ilves"],
  [28, "2.5.2026", "17:00", "FF Jaro", "TPS"],
  [29, "2.5.2026", "17:00", "IFK Mariehamn", "VPS"],
  [30, "2.5.2026", "19:00", "AC Oulu", "KuPS"],

  [31, "4.5.2026", "19:00", "HJK", "FC Lahti"],

  [32, "5.5.2026", "19:00", "IF Gnistan", "FC Inter"],

  [33, "8.5.2026", "18:00", "Ilves", "AC Oulu"],
  [34, "8.5.2026", "18:00", "TPS", "HJK"],
  [35, "8.5.2026", "20:00", "KuPS", "SJK"],

  [36, "9.5.2026", "15:00", "FC Inter", "FF Jaro"],
  [37, "9.5.2026", "17:00", "VPS", "IF Gnistan"],

  [38, "10.5.2026", "15:00", "FC Lahti", "IFK Mariehamn"],

  [39, "16.5.2026", "14:00", "HJK", "Ilves"],
  [40, "16.5.2026", "17:00", "IFK Mariehamn", "KuPS"],
  [41, "16.5.2026", "17:00", "SJK", "FC Inter"],
  [42, "16.5.2026", "19:00", "AC Oulu", "TPS"],
  [43, "16.5.2026", "19:00", "IF Gnistan", "FF Jaro"],

  [44, "18.5.2026", "18:00", "FC Lahti", "VPS"],

  [45, "20.5.2026", "18:00", "Ilves", "FC Inter"],
  [46, "20.5.2026", "19:00", "KuPS", "FF Jaro"],

  [47, "22.5.2026", "19:00", "VPS", "HJK"],

  [48, "23.5.2026", "14:00", "FC Inter", "TPS"],
  [49, "23.5.2026", "17:00", "FF Jaro", "IFK Mariehamn"],
  [50, "23.5.2026", "17:00", "Ilves", "IF Gnistan"],
  [51, "23.5.2026", "17:00", "KuPS", "FC Lahti"],
  [52, "23.5.2026", "17:00", "SJK", "AC Oulu"],

  [53, "30.5.2026", "15:00", "HJK", "IFK Mariehamn"],
  [54, "30.5.2026", "17:00", "IF Gnistan", "SJK"],
  [55, "30.5.2026", "17:00", "KuPS", "FC Inter"],
  [56, "30.5.2026", "17:00", "TPS", "VPS"],
  [57, "30.5.2026", "19:00", "FC Lahti", "Ilves"],

  [58, "31.5.2026", "16:00", "AC Oulu", "FF Jaro"],

  [59, "13.6.2026", "15:00", "FC Inter", "AC Oulu"],
  [60, "13.6.2026", "15:00", "Ilves", "TPS"],
  [61, "13.6.2026", "17:00", "FF Jaro", "HJK"],
  [62, "13.6.2026", "17:00", "VPS", "KuPS"],
  [63, "13.6.2026", "19:00", "FC Lahti", "SJK"],
  [64, "13.6.2026", "19:00", "IFK Mariehamn", "IF Gnistan"],

  [65, "17.6.2026", "18:00", "AC Oulu", "IFK Mariehamn"],
  [66, "17.6.2026", "18:00", "HJK", "FC Inter"],
  [67, "17.6.2026", "18:00", "Ilves", "FF Jaro"],
  [68, "17.6.2026", "18:00", "TPS", "KuPS"],
  [69, "17.6.2026", "21:00", "IF Gnistan", "FC Lahti"],
  [70, "17.6.2026", "21:00", "SJK", "VPS"],

  [71, "23.6.2026", "18:00", "FC Lahti", "TPS"],
  [72, "23.6.2026", "18:00", "KuPS", "Ilves"],
  [73, "23.6.2026", "18:00", "VPS", "AC Oulu"],
  [74, "23.6.2026", "19:00", "FC Inter", "SJK"],
  [75, "23.6.2026", "19:00", "FF Jaro", "IF Gnistan"],
  [76, "23.6.2026", "20:00", "IFK Mariehamn", "HJK"],

  [77, "27.6.2026", "14:00", "Ilves", "SJK"],
  [78, "27.6.2026", "17:00", "HJK", "KuPS"],
  [79, "27.6.2026", "17:00", "IFK Mariehamn", "FC Inter"],
  [80, "27.6.2026", "19:00", "IF Gnistan", "VPS"],
  [81, "27.6.2026", "19:00", "TPS", "FF Jaro"],
  [82, "27.6.2026", "21:00", "AC Oulu", "FC Lahti"],

  [83, "4.7.2026", "15:00", "FC Lahti", "IF Gnistan"],
  [84, "4.7.2026", "17:00", "FF Jaro", "Ilves"],
  [85, "4.7.2026", "17:00", "SJK", "TPS"],
  [86, "4.7.2026", "18:00", "VPS", "IFK Mariehamn"],

  [87, "10.7.2026", "19:00", "VPS", "SJK"],

  [88, "11.7.2026", "15:00", "FC Lahti", "HJK"],
  [89, "11.7.2026", "17:00", "IF Gnistan", "IFK Mariehamn"],
  [90, "11.7.2026", "17:00", "TPS", "AC Oulu"],

  [91, "18.7.2026", "15:00", "HJK", "VPS"],
  [92, "18.7.2026", "17:00", "AC Oulu", "IF Gnistan"],
  [93, "18.7.2026", "17:00", "SJK", "KuPS"],

  [94, "19.7.2026", "18:30", "FF Jaro", "FC Inter"],

  [95, "20.7.2026", "18:00", "TPS", "Ilves"],
  [96, "20.7.2026", "19:00", "IFK Mariehamn", "FC Lahti"],

  [97, "24.7.2026", "19:00", "FF Jaro", "SJK"],

  [98, "25.7.2026", "16:00", "IFK Mariehamn", "AC Oulu"],
  [99, "25.7.2026", "17:00", "KuPS", "VPS"],
  [100, "25.7.2026", "19:00", "Ilves", "FC Lahti"],

  [101, "26.7.2026", "15:00", "FC Inter", "IF Gnistan"],
  [102, "26.7.2026", "17:00", "HJK", "TPS"],

  [103, "1.8.2026", "15:00", "TPS", "IFK Mariehamn"],
  [104, "1.8.2026", "15:00", "VPS", "FC Inter"],
  [105, "1.8.2026", "17:00", "AC Oulu", "Ilves"],
  [106, "1.8.2026", "18:00", "FC Lahti", "FF Jaro"],
  [107, "1.8.2026", "19:00", "IF Gnistan", "KuPS"],

  [108, "3.8.2026", "19:00", "SJK", "HJK"],

  [109, "7.8.2026", "19:00", "SJK", "IF Gnistan"],

  [110, "8.8.2026", "15:00", "AC Oulu", "HJK"],
  [111, "8.8.2026", "17:00", "FC Inter", "FC Lahti"],
  [112, "8.8.2026", "17:00", "Ilves", "IFK Mariehamn"],
  [113, "8.8.2026", "17:00", "KuPS", "TPS"],
  [114, "8.8.2026", "19:00", "FF Jaro", "VPS"],

  [115, "14.8.2026", "18:00", "VPS", "TPS"],

  [116, "15.8.2026", "15:00", "FC Lahti", "KuPS"],
  [117, "15.8.2026", "17:00", "AC Oulu", "FC Inter"],
  [118, "15.8.2026", "19:00", "IFK Mariehamn", "SJK"],

  [119, "16.8.2026", "16:00", "HJK", "FF Jaro"],

  [120, "17.8.2026", "18:00", "IF Gnistan", "Ilves"],

  [121, "21.8.2026", "19:00", "SJK", "FC Lahti"],

  [122, "22.8.2026", "14:00", "TPS", "FC Inter"],
  [123, "22.8.2026", "17:00", "FF Jaro", "AC Oulu"],
  [124, "22.8.2026", "17:00", "Ilves", "VPS"],
  [125, "22.8.2026", "17:00", "KuPS", "IFK Mariehamn"],

  [126, "23.8.2026", "15:00", "HJK", "IF Gnistan"],

  [127, "31.8.2026", "19:00", "AC Oulu", "SJK"],
  [128, "31.8.2026", "19:00", "FC Inter", "KuPS"],
  [129, "31.8.2026", "19:00", "IF Gnistan", "TPS"],
  [130, "31.8.2026", "19:00", "IFK Mariehamn", "FF Jaro"],
  [131, "31.8.2026", "19:00", "Ilves", "HJK"],
  [132, "31.8.2026", "19:00", "VPS", "FC Lahti"],
];

export const fixtures: Fixture[] = FIXTURE_ROWS.map(([id, dateFi, time, home, away]) => ({
  id,
  homeTeamId: teamIdByName(home),
  awayTeamId: teamIdByName(away),
  date: toIsoEET(dateFi, time),
}));
