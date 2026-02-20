// api/leaderboard.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis";
import { getSessionFromReq } from "../lib/session";

type Row = { username: string; total: number; lastPoints: number };
type LeaderboardResp = {
  rows: Row[];
  gamesFinalized: number;
  lastGameId: number | null;
};

async function scanKeys(match: string) {
  const keys: string[] = [];
  let cursor = "0";

  do {
    const resp = await redis.scan(cursor, { match, count: 200 });
    // Upstash returns: [nextCursor, keys]
    const nextCursor = resp[0];
    const batch = resp[1];

    cursor = String(nextCursor);
    keys.push(...(batch ?? []));
  } while (cursor !== "0");

  return keys;
}

function parseHashTeam(teamHash: Record<string, string> | null) {
  if (!teamHash) return null;

  const s = teamHash.startingXIIds ?? teamHash.starting ?? "";
  const b = teamHash.benchIds ?? teamHash.bench ?? "";

  const toArr = (v: string) => {
    const trimmed = (v ?? "").trim();
    if (!trimmed) return [];
    if (trimmed.startsWith("[")) {
      try {
        const arr = JSON.parse(trimmed);
        return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
      } catch {
        return [];
      }
    }
    return trimmed
      .split(",")
      .map((x) => Number(x.trim()))
      .filter(Number.isFinite);
  };

  return { startingXIIds: toArr(s), benchIds: toArr(b) };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    // 1) Discover users who have teams saved
    const teamKeys = await scanKeys(`${PREFIX}:team:*`);
    const users = teamKeys
      .map((k) => k.split(":").pop()!)
      .filter(Boolean);

    // 2) Which games have been finalized?
    const finalized = await redis.smembers(`${PREFIX}:games_finalized`);
    const gameIds = finalized
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);

    const gamesFinalized = gameIds.length;
    const lastGameId = gamesFinalized > 0 ? gameIds[gamesFinalized - 1] : null;

    const rows: Row[] = [];

    for (const username of users) {
      // Ensure team exists in redis (supports GET or hash)
      const teamKey = `${PREFIX}:team:${username}`;
      const teamGet = await redis.get<any>(teamKey);
      let teamExists = !!teamGet;

      if (!teamExists) {
        const teamHash = await redis.hgetall<Record<string, string>>(teamKey);
        const parsed = parseHashTeam(teamHash);
        teamExists = !!parsed;
      }
      if (!teamExists) continue;

      // 3) Total points across all finalized games
      let total = 0;
      for (const gid of gameIds) {
        const pts = await redis.get<number>(`${PREFIX}:user:${username}:game:${gid}:points`);
        total += Number(pts ?? 0);
      }

      // 4) Last finalized gameweek points (if any)
      let lastPoints = 0;
      if (lastGameId != null) {
        const pts = await redis.get<number>(`${PREFIX}:user:${username}:game:${lastGameId}:points`);
        lastPoints = Number(pts ?? 0);
      }

      rows.push({ username, total, lastPoints });
    }

    // sort by total desc, then lastPoints desc, then username
    rows.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.lastPoints !== a.lastPoints) return b.lastPoints - a.lastPoints;
      return a.username.localeCompare(b.username);
    });

    const payload: LeaderboardResp = { rows, gamesFinalized, lastGameId };
    return res.status(200).json(payload);
  } catch (e: unknown) {
    console.error("LEADERBOARD_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}