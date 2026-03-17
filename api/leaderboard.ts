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

function parseHashTeam(teamHash: Record<string, string> | null) {
  if (!teamHash || Object.keys(teamHash).length === 0) return null;

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

  const startingXIIds = toArr(s);
  const benchIds = toArr(b);

  if (startingXIIds.length === 0 && benchIds.length === 0) return null;

  return { startingXIIds, benchIds };
}

async function getPoints(username: string, gameId: number): Promise<number> {
  const candidates = Array.from(new Set([username, username.toLowerCase()]));

  for (const name of candidates) {
    const key1 = `${PREFIX}:user:${name}:game:${gameId}:points`;
    const v1 = await redis.get<number | string>(key1);
    if (v1 != null) {
      const n = Number(v1);
      if (Number.isFinite(n)) return n;
    }

    const key2 = `${PREFIX}:user:${name}:points`;
    const v2 = await redis.hget<number | string>(key2, String(gameId));
    if (v2 != null) {
      const n = Number(v2);
      if (Number.isFinite(n)) return n;
    }

    const key3 = `${PREFIX}:points:${name}`;
    const v3 = await redis.hget<number | string>(key3, String(gameId));
    if (v3 != null) {
      const n = Number(v3);
      if (Number.isFinite(n)) return n;
    }

    const v4 = await redis.get<Record<string, number> | null>(key2);
    if (v4 && typeof v4 === "object") {
      const n = Number(v4[String(gameId)]);
      if (Number.isFinite(n)) return n;
    }
  }

  return 0;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const teamKeys = await scanKeys(`${PREFIX}:team:*`);
    const users = teamKeys.map((k) => k.split(":").pop()!).filter(Boolean);

    const finalized = await redis.smembers(`${PREFIX}:games_finalized`);
    const gameIds = finalized
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);

    const lastGameId = gameIds.length ? gameIds[gameIds.length - 1] : null;

    const rows: Row[] = [];

    for (const username of users) {
      const teamKey = `${PREFIX}:team:${username}`;
      const teamGet = await redis.get<any>(teamKey);
      let teamExists = !!teamGet;

      if (!teamExists) {
        const teamHash = await redis.hgetall<Record<string, string>>(teamKey);
        teamExists = !!parseHashTeam(teamHash);
      }
      if (!teamExists) continue;

      let total = 0;
      for (const gid of gameIds) {
        total += await getPoints(username, gid);
      }

      const last = lastGameId == null ? 0 : await getPoints(username, lastGameId);

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