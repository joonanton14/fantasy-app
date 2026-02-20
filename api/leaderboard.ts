// api/leaderboard.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis";
import { getSessionFromReq } from "../lib/session";

type Row = { username: string; total: number; last: number };
type Resp = { rows: Row[]; gamesFinalized: number; lastGameId: number | null };

async function scanKeys(match: string) {
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

// fantasy:user:<u>:game:<gid>:points
function parsePointsKey(key: string): { username: string; gameId: number } | null {
  const parts = key.split(":");
  // [fantasy, user, <u>, game, <gid>, points]
  if (parts.length < 6) return null;
  if (parts[0] !== PREFIX) return null;
  if (parts[1] !== "user") return null;
  if (parts[3] !== "game") return null;
  if (parts[5] !== "points") return null;

  const username = parts[2];
  const gameId = Number(parts[4]);
  if (!username) return null;
  if (!Number.isInteger(gameId) || gameId <= 0) return null;

  return { username, gameId };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    // Use finalized list only to define "gameweeks that count"
    const finalizedRaw = await redis.smembers(`${PREFIX}:games_finalized`);
    const finalized = finalizedRaw
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);

    const gamesFinalized = finalized.length;
    const lastGameId = gamesFinalized ? finalized[gamesFinalized - 1] : null;
    const finalizedSet = new Set<number>(finalized);

    // Build leaderboard from points keys (guaranteed to match what finalize-game wrote)
    const pointKeys = await scanKeys(`${PREFIX}:user:*:game:*:points`);

    // username -> gameId -> points
    const byUser = new Map<string, Map<number, number>>();

    for (const k of pointKeys) {
      const parsed = parsePointsKey(k);
      if (!parsed) continue;

      // only count games that are finalized
      if (!finalizedSet.has(parsed.gameId)) continue;

      const v = await redis.get<number | string>(k);
      const pts = Number(v ?? 0);

      let userMap = byUser.get(parsed.username);
      if (!userMap) {
        userMap = new Map<number, number>();
        byUser.set(parsed.username, userMap);
      }
      userMap.set(parsed.gameId, pts);
    }

    const rows: Row[] = [];
    for (const [username, gamesMap] of byUser.entries()) {
      let total = 0;
      for (const gid of finalized) total += Number(gamesMap.get(gid) ?? 0);

      const last = lastGameId ? Number(gamesMap.get(lastGameId) ?? 0) : 0;
      rows.push({ username, total, last });
    }

    rows.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      if (b.last !== a.last) return b.last - a.last;
      return a.username.localeCompare(b.username);
    });

    const payload: Resp = { rows, gamesFinalized, lastGameId };
    return res.status(200).json(payload);
  } catch (e: unknown) {
    console.error("LEADERBOARD_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}