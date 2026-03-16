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

function normalizeUsername(u: string) {
  return u.trim().toLowerCase();
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

async function getRoundPoints(username: string, round: number): Promise<number> {
  const normalized = normalizeUsername(username);

  const key1 = `${PREFIX}:user:${username}:gw:${round}:points`;
  const v1 = await redis.get<number>(key1);
  if (v1 != null) return Number(v1) || 0;

  if (normalized !== username) {
    const key2 = `${PREFIX}:user:${normalized}:gw:${round}:points`;
    const v2 = await redis.get<number>(key2);
    if (v2 != null) return Number(v2) || 0;
  }

  return 0;
}

async function getLegacyGamePoints(username: string, gameId: number): Promise<number> {
  const normalized = normalizeUsername(username);

  const key1 = `${PREFIX}:user:${username}:game:${gameId}:points`;
  const v1 = await redis.get<number>(key1);
  if (v1 != null) return Number(v1) || 0;

  if (normalized !== username) {
    const key2 = `${PREFIX}:user:${normalized}:game:${gameId}:points`;
    const v2 = await redis.get<number>(key2);
    if (v2 != null) return Number(v2) || 0;
  }

  return 0;
}

async function getSavedRounds(): Promise<number[]> {
  const keys = await scanKeys(`${PREFIX}:user:*:gw:*:points`);

  const rounds = new Set<number>();

  for (const key of keys) {
    const m = key.match(/:gw:(\d+):points$/);
    if (!m) continue;

    const round = Number(m[1]);
    if (Number.isInteger(round) && round > 0) {
      rounds.add(round);
    }
  }

  return Array.from(rounds).sort((a, b) => a - b);
}

async function getLegacyFinalizedGames(): Promise<number[]> {
  const finalized = await redis.smembers(`${PREFIX}:games_finalized`);
  return finalized
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const teamKeys = await scanKeys(`${PREFIX}:team:*`);
    const users = teamKeys.map((k) => k.split(":").pop()!).filter(Boolean);

    const rounds = await getSavedRounds();
    const lastRound = rounds.length ? rounds[rounds.length - 1] : null;

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
      let last = 0;

      if (rounds.length > 0) {
        for (const round of rounds) {
          total += await getRoundPoints(username, round);
        }
        last = lastRound == null ? 0 : await getRoundPoints(username, lastRound);
      } else {
        const gameIds = await getLegacyFinalizedGames();
        for (const gid of gameIds) {
          total += await getLegacyGamePoints(username, gid);
        }
        const lastGameId = gameIds.length ? gameIds[gameIds.length - 1] : null;
        last = lastGameId == null ? 0 : await getLegacyGamePoints(username, lastGameId);
      }

      rows.push({ username, total, last });
    }

    rows.sort((a, b) => b.total - a.total || a.username.localeCompare(b.username));

    return res.status(200).json({
      rows,
      roundsFinalized: rounds.length,
      lastRound,
    });
  } catch (e: unknown) {
    console.error("LEADERBOARD_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}