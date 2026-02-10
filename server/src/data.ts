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
    const playersDir = path.resolve(__dirname, '..', '..', 'players');
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

export const fixtures: Fixture[] = [];
let fixtureId = 1;
for (let i = 0; i < teams.length; i++) {
  for (let j = 0; j < teams.length; j++) {
    if (i === j) continue;
    const homeTeam = teams[i];
    const awayTeam = teams[j];
    const matchNumber = fixtureId - 1;
    const date = new Date();
    date.setDate(date.getDate() + matchNumber * 7);
    fixtures.push({
      id: fixtureId++,
      homeTeamId: homeTeam.id,
      awayTeamId: awayTeam.id,
      date: date.toISOString()
    });
  }
}