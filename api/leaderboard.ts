import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis";
import { getSessionFromReq } from "../lib/session";
import { fixtures } from "../server/src/data";

type Row = { username: string; total: number; last: number };

const GAME_ROUND = new Map<number, number>(
  fixtures.map((f) => [f.id, f.round])
);

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

async function getRoundPoints(username: string, roundNum: number): Promise<number> {
  const candidates = Array.from(new Set([username, username.toLowerCase()]));

  for (const name of candidates) {
    const key = `${PREFIX}:user:${name}:gw:${roundNum}:points`;
    const v = await redis.get<number | string>(key);
    if (v != null) {
      const n = Number(v);
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

    const finalizedRounds = Array.from(
      new Set(
        gameIds
          .map((gid) => GAME_ROUND.get(gid))
          .filter((r): r is number => Number.isInteger(r))
      )
    ).sort((a, b) => a - b);

    const lastRound = finalizedRounds.length
      ? finalizedRounds[finalizedRounds.length - 1]
      : null;

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
      for (const roundNum of finalizedRounds) {
        total += await getRoundPoints(username, roundNum);
      }

      const last = lastRound == null ? 0 : await getRoundPoints(username, lastRound);

      rows.push({ username, total, last });
    }

    rows.sort((a, b) => b.total - a.total || a.username.localeCompare(b.username));

    return res.status(200).json({
      rows,
      gamesFinalized: gameIds.length,
      lastRound,
      debug: {
        finalizedGameIds: gameIds,
        finalizedRounds,
        usersFound: users.length,
      },
    });
  } catch (e: unknown) {
    console.error("LEADERBOARD_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}