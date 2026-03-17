import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis";
import { getSessionFromReq } from "../lib/session";

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

function parsePointsKey(
  key: string
): { username: string; gameId: number } | null {
  // expected: ${PREFIX}:user:${username}:game:${gameId}:points
  const prefix = `${PREFIX}:user:`;
  if (!key.startsWith(prefix)) return null;
  if (!key.endsWith(":points")) return null;

  const rest = key.slice(prefix.length); // ${username}:game:${gameId}:points
  const parts = rest.split(":");

  if (parts.length < 4) return null;
  if (parts[1] !== "game") return null;
  if (parts[3] !== "points") return null;

  const username = parts[0];
  const gameId = Number(parts[2]);

  if (!username) return null;
  if (!Number.isInteger(gameId) || gameId <= 0) return null;

  return { username, gameId };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (req.method !== "GET") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const finalized = await redis.smembers(`${PREFIX}:games_finalized`);
    const gameIds = finalized
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);

    const finalizedSet = new Set(gameIds);
    const lastGameId = gameIds.length ? gameIds[gameIds.length - 1] : null;

    const pointKeys = await scanKeys(`${PREFIX}:user:*:game:*:points`);

    const byUser = new Map<string, Row>();

    for (const key of pointKeys) {
      const parsed = parsePointsKey(key);
      if (!parsed) continue;

      const { username, gameId } = parsed;
      if (!finalizedSet.has(gameId)) continue;

      const raw = await redis.get<number | string>(key);
      const points = Number(raw);
      if (!Number.isFinite(points)) continue;

      const cur = byUser.get(username) ?? { username, total: 0, last: 0 };
      cur.total += points;

      if (lastGameId != null && gameId === lastGameId) {
        cur.last += points;
      }

      byUser.set(username, cur);
    }

    const rows = Array.from(byUser.values()).sort(
      (a, b) => b.total - a.total || a.username.localeCompare(b.username)
    );

    return res.status(200).json({
      rows,
      gamesFinalized: gameIds.length,
      lastGameId,
    });
  } catch (e: unknown) {
    console.error("LEADERBOARD_CRASH", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    });
  }
}