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



const FIXTURE_ROWS: Array<[number, string, string, string, string, number]> = [
  // Kierros 1
  [1, "4.4.2026", "13:00", "FC Inter", "VPS", 1],
  [2, "4.4.2026", "15:00", "HJK", "SJK", 1],
  [3, "4.4.2026", "17:00", "FF Jaro", "FC Lahti", 1],
  [4, "4.4.2026", "17:00", "IFK Mariehamn", "TPS", 1],
  [5, "4.4.2026", "17:00", "Ilves", "KuPS", 1],
  [6, "4.4.2026", "19:00", "IF Gnistan", "AC Oulu", 1],

  // Kierros 2
  [7, "10.4.2026", "18:00", "TPS", "FC Lahti", 2],
  [8, "10.4.2026", "19:00", "SJK", "IFK Mariehamn", 2],
  [9, "10.4.2026", "20:00", "VPS", "FF Jaro", 2],
  [10, "11.4.2026", "15:00", "KuPS", "IF Gnistan", 2],
  [11, "11.4.2026", "17:00", "HJK", "AC Oulu", 2],
  [12, "11.4.2026", "19:00", "FC Inter", "Ilves", 2],

  // Kierros 3
  [13, "18.4.2026", "14:00", "IF Gnistan", "HJK", 3],
  [14, "18.4.2026", "16:00", "FF Jaro", "KuPS", 3],
  [15, "18.4.2026", "17:00", "AC Oulu", "VPS", 3],
  [16, "18.4.2026", "17:00", "FC Lahti", "FC Inter", 3],
  [17, "18.4.2026", "17:00", "TPS", "SJK", 3],
  [18, "18.4.2026", "19:00", "IFK Mariehamn", "Ilves", 3],

  // Kierros 4  (note: you had a single match on 22.4 — that's Kierros 4 in order)
  [19, "22.4.2026", "18:00", "KuPS", "AC Oulu", 4],
  [20, "24.4.2026", "18:00", "TPS", "IF Gnistan", 4],
  [21, "24.4.2026", "18:00", "VPS", "Ilves", 4],
  [22, "24.4.2026", "19:00", "SJK", "FF Jaro", 4],
  [23, "25.4.2026", "15:00", "FC Lahti", "AC Oulu", 4],
  [24, "25.4.2026", "17:00", "FC Inter", "IFK Mariehamn", 4],
  [25, "26.4.2026", "16:00", "KuPS", "HJK", 4],

  // Kierros 5
  [26, "29.4.2026", "19:00", "FC Inter", "HJK", 5],
  [27, "2.5.2026", "15:00", "SJK", "Ilves", 5],
  [28, "2.5.2026", "17:00", "FF Jaro", "TPS", 5],
  [29, "2.5.2026", "17:00", "IFK Mariehamn", "VPS", 5],
  [30, "2.5.2026", "19:00", "AC Oulu", "KuPS", 5],
  [31, "4.5.2026", "19:00", "HJK", "FC Lahti", 5],
  [32, "5.5.2026", "19:00", "IF Gnistan", "FC Inter", 5],

  // Kierros 6
  [33, "8.5.2026", "18:00", "Ilves", "AC Oulu", 6],
  [34, "8.5.2026", "18:00", "TPS", "HJK", 6],
  [35, "8.5.2026", "20:00", "KuPS", "SJK", 6],
  [36, "9.5.2026", "15:00", "FC Inter", "FF Jaro", 6],
  [37, "9.5.2026", "17:00", "VPS", "IF Gnistan", 6],
  [38, "10.5.2026", "15:00", "FC Lahti", "IFK Mariehamn", 6],

  // Kierros 7
  [39, "16.5.2026", "14:00", "HJK", "Ilves", 7],
  [40, "16.5.2026", "17:00", "IFK Mariehamn", "KuPS", 7],
  [41, "16.5.2026", "17:00", "SJK", "FC Inter", 7],
  [42, "16.5.2026", "19:00", "AC Oulu", "TPS", 7],
  [43, "16.5.2026", "19:00", "IF Gnistan", "FF Jaro", 7],
  [44, "18.5.2026", "18:00", "FC Lahti", "VPS", 7],

  // Kierros 8
  [45, "20.5.2026", "18:00", "Ilves", "FC Inter", 8],
  [46, "20.5.2026", "19:00", "KuPS", "FF Jaro", 8],
  [47, "22.5.2026", "19:00", "VPS", "HJK", 8],
  [48, "23.5.2026", "14:00", "FC Inter", "TPS", 8],
  [49, "23.5.2026", "17:00", "FF Jaro", "IFK Mariehamn", 8],
  [50, "23.5.2026", "17:00", "Ilves", "IF Gnistan", 8],
  [51, "23.5.2026", "17:00", "KuPS", "FC Lahti", 8],
  [52, "23.5.2026", "17:00", "SJK", "AC Oulu", 8],

  // Kierros 9
  [53, "30.5.2026", "15:00", "HJK", "IFK Mariehamn", 9],
  [54, "30.5.2026", "17:00", "IF Gnistan", "SJK", 9],
  [55, "30.5.2026", "17:00", "KuPS", "FC Inter", 9],
  [56, "30.5.2026", "17:00", "TPS", "VPS", 9],
  [57, "30.5.2026", "19:00", "FC Lahti", "Ilves", 9],
  [58, "31.5.2026", "16:00", "AC Oulu", "FF Jaro", 9],

  // Kierros 10
  [59, "13.6.2026", "15:00", "FC Inter", "AC Oulu", 10],
  [60, "13.6.2026", "15:00", "Ilves", "TPS", 10],
  [61, "13.6.2026", "17:00", "FF Jaro", "HJK", 10],
  [62, "13.6.2026", "17:00", "VPS", "KuPS", 10],
  [63, "13.6.2026", "19:00", "FC Lahti", "SJK", 10],
  [64, "13.6.2026", "19:00", "IFK Mariehamn", "IF Gnistan", 10],

  // Kierros 11
  [65, "17.6.2026", "18:00", "AC Oulu", "IFK Mariehamn", 11],
  [66, "17.6.2026", "18:00", "HJK", "FC Inter", 11],
  [67, "17.6.2026", "18:00", "Ilves", "FF Jaro", 11],
  [68, "17.6.2026", "18:00", "TPS", "KuPS", 11],
  [69, "17.6.2026", "21:00", "IF Gnistan", "FC Lahti", 11],
  [70, "17.6.2026", "21:00", "SJK", "VPS", 11],

  // Kierros 12
  [71, "23.6.2026", "18:00", "FC Lahti", "TPS", 12],
  [72, "23.6.2026", "18:00", "KuPS", "Ilves", 12],
  [73, "23.6.2026", "18:00", "VPS", "AC Oulu", 12],
  [74, "23.6.2026", "19:00", "FC Inter", "SJK", 12],
  [75, "23.6.2026", "19:00", "FF Jaro", "IF Gnistan", 12],
  [76, "23.6.2026", "20:00", "IFK Mariehamn", "HJK", 12],

  // Kierros 13
  [77, "27.6.2026", "14:00", "Ilves", "SJK", 13],
  [78, "27.6.2026", "17:00", "HJK", "KuPS", 13],
  [79, "27.6.2026", "17:00", "IFK Mariehamn", "FC Inter", 13],
  [80, "27.6.2026", "19:00", "IF Gnistan", "VPS", 13],
  [81, "27.6.2026", "19:00", "TPS", "FF Jaro", 13],
  [82, "27.6.2026", "21:00", "AC Oulu", "FC Lahti", 13],

  // Kierros 14
  [83, "4.7.2026", "15:00", "FC Lahti", "IF Gnistan", 14],
  [84, "4.7.2026", "17:00", "FF Jaro", "Ilves", 14],
  [85, "4.7.2026", "17:00", "SJK", "TPS", 14],
  [86, "4.7.2026", "18:00", "VPS", "IFK Mariehamn", 14],

  // Kierros 15
  [87, "10.7.2026", "19:00", "VPS", "SJK", 15],
  [88, "11.7.2026", "15:00", "FC Lahti", "HJK", 15],
  [89, "11.7.2026", "17:00", "IF Gnistan", "IFK Mariehamn", 15],
  [90, "11.7.2026", "17:00", "TPS", "AC Oulu", 15],

  // Kierros 16
  [91, "18.7.2026", "15:00", "HJK", "VPS", 16],
  [92, "18.7.2026", "17:00", "AC Oulu", "IF Gnistan", 16],
  [93, "18.7.2026", "17:00", "SJK", "KuPS", 16],
  [94, "19.7.2026", "18:30", "FF Jaro", "FC Inter", 16],
  [95, "20.7.2026", "18:00", "TPS", "Ilves", 16],
  [96, "20.7.2026", "19:00", "IFK Mariehamn", "FC Lahti", 16],

  // Kierros 17
  [97, "24.7.2026", "19:00", "FF Jaro", "SJK", 17],
  [98, "25.7.2026", "16:00", "IFK Mariehamn", "AC Oulu", 17],
  [99, "25.7.2026", "17:00", "KuPS", "VPS", 17],
  [100, "25.7.2026", "19:00", "Ilves", "FC Lahti", 17],
  [101, "26.7.2026", "15:00", "FC Inter", "IF Gnistan", 17],
  [102, "26.7.2026", "17:00", "HJK", "TPS", 17],

  // Kierros 18
  [103, "1.8.2026", "15:00", "TPS", "IFK Mariehamn", 18],
  [104, "1.8.2026", "15:00", "VPS", "FC Inter", 18],
  [105, "1.8.2026", "17:00", "AC Oulu", "Ilves", 18],
  [106, "1.8.2026", "18:00", "FC Lahti", "FF Jaro", 18],
  [107, "1.8.2026", "19:00", "IF Gnistan", "KuPS", 18],
  [108, "3.8.2026", "19:00", "SJK", "HJK", 18],

  // Kierros 19
  [109, "7.8.2026", "19:00", "SJK", "IF Gnistan", 19],
  [110, "8.8.2026", "15:00", "AC Oulu", "HJK", 19],
  [111, "8.8.2026", "17:00", "FC Inter", "FC Lahti", 19],
  [112, "8.8.2026", "17:00", "Ilves", "IFK Mariehamn", 19],
  [113, "8.8.2026", "17:00", "KuPS", "TPS", 19],
  [114, "8.8.2026", "19:00", "FF Jaro", "VPS", 19],

  // Kierros 20
  [115, "14.8.2026", "18:00", "VPS", "TPS", 20],
  [116, "15.8.2026", "15:00", "FC Lahti", "KuPS", 20],
  [117, "15.8.2026", "17:00", "AC Oulu", "FC Inter", 20],
  [118, "15.8.2026", "19:00", "IFK Mariehamn", "SJK", 20],
  [119, "16.8.2026", "16:00", "HJK", "FF Jaro", 20],
  [120, "17.8.2026", "18:00", "IF Gnistan", "Ilves", 20],

  // Kierros 21
  [121, "21.8.2026", "19:00", "SJK", "FC Lahti", 21],
  [122, "22.8.2026", "14:00", "TPS", "FC Inter", 21],
  [123, "22.8.2026", "17:00", "FF Jaro", "AC Oulu", 21],
  [124, "22.8.2026", "17:00", "Ilves", "VPS", 21],
  [125, "22.8.2026", "17:00", "KuPS", "IFK Mariehamn", 21],
  [126, "23.8.2026", "15:00", "HJK", "IF Gnistan", 21],

  // Kierros 22
  [127, "31.8.2026", "19:00", "AC Oulu", "SJK", 22],
  [128, "31.8.2026", "19:00", "FC Inter", "KuPS", 22],
  [129, "31.8.2026", "19:00", "IF Gnistan", "TPS", 22],
  [130, "31.8.2026", "19:00", "IFK Mariehamn", "FF Jaro", 22],
  [131, "31.8.2026", "19:00", "Ilves", "HJK", 22],
  [132, "31.8.2026", "19:00", "VPS", "FC Lahti", 22],
];

export const fixtures: Fixture[] = FIXTURE_ROWS.map(([id, dateFi, time, home, away, round]) => ({
  id,
  round,
  homeTeamId: teamIdByName(home),
  awayTeamId: teamIdByName(away),
  date: toIsoEET(dateFi, time),
}));
