// api/leaderboard.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis";
import { getSessionFromReq } from "../lib/session";

type Row = { username: string; total: number };

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

  // If your hash fields are different, adjust here.
  // Common options:
  // - startingXIIds stored as JSON string: "[1,2,3]"
  // - OR stored as comma string: "1,2,3"
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

    // discover users who have teams saved
    const teamKeys = await scanKeys(`${PREFIX}:team:*`);
    const users = teamKeys
      .map((k) => k.split(":").pop()!)
      .filter(Boolean);

    // which games have been finalized?
    const finalized = await redis.smembers(`${PREFIX}:games_finalized`);
    const gameIds = finalized
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0);

    const rows: Row[] = [];

    for (const username of users) {
      // (optional) ensure team exists in redis (supports GET or hash)
      const teamKey = `${PREFIX}:team:${username}`;
      const teamGet = await redis.get<any>(teamKey);
      let teamExists = !!teamGet;

      if (!teamExists) {
        const teamHash = await redis.hgetall<Record<string, string>>(teamKey);
        const parsed = parseHashTeam(teamHash);
        teamExists = !!parsed;
      }
      if (!teamExists) continue;

      let total = 0;
      for (const gid of gameIds) {
        const pts = await redis.get<number>(`${PREFIX}:user:${username}:game:${gid}:points`);
        total += Number(pts ?? 0);
      }

      rows.push({ username, total });
    }

    rows.sort((a, b) => b.total - a.total);

    return res.status(200).json({ rows, gamesFinalized: gameIds.length });
  } catch (e: unknown) {
    console.error("LEADERBOARD_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
