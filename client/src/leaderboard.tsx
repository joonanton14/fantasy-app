// api/leaderboard.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";
import { getSessionFromReq } from "../../lib/session";

type Row = { username: string; total: number; last: number };

async function scanKeys(match: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = "0";

  do {
    const resp = await redis.scan(cursor, { match, count: 200 });
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

    // Discover users by existing team keys
    const teamKeys = await scanKeys(`${PREFIX}:team:*`);
    const users = teamKeys.map((k) => k.split(":").pop()!).filter(Boolean);

    // Finalized games
    const finalized = await redis.smembers(`${PREFIX}:games_finalized`);
    const gameIds = finalized
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);

    const lastGameId = gameIds.length ? gameIds[gameIds.length - 1] : null;

    const rows: Row[] = [];

    for (const username of users) {
      const teamKey = `${PREFIX}:team:${username}`;

      // Ensure team actually exists (supports GET object OR hash form)
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

      const last =
        lastGameId == null
          ? 0
          : Number(await redis.get<number>(`${PREFIX}:user:${username}:game:${lastGameId}:points`)) || 0;

      rows.push({ username, total, last });
    }

    rows.sort((a, b) => b.total - a.total);

    return res.status(200).json({
      rows,
      gamesFinalized: gameIds.length,
      lastGameId,
    });
  } catch (e: unknown) {
    console.error("LEADERBOARD_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}