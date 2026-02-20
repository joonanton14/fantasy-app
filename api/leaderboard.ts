// api/leaderboard.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis";
import { getSessionFromReq } from "../lib/session";

type Row = { username: string; total: number };

function canon(u: string) {
  return String(u ?? "").trim().toLowerCase();
}

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

    // discover users who have teams saved
    const teamKeys = await scanKeys(`${PREFIX}:team:*`);
    const rawUsers = teamKeys.map((k) => k.split(":").pop()!).filter(Boolean);

    // which games have been finalized?
    const finalized = await redis.smembers(`${PREFIX}:games_finalized`);
    const gameIds = finalized
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0);

    const rows: Row[] = [];

    // optional debug: show which points keys exist
    const debugPerUser: Array<{
      username: string;
      teamKeyTried: string[];
      canon: string;
      pointsKeys: string[];
      pointsValues: Array<number | null>;
    }> = [];

    for (const username of rawUsers) {
      const c = canon(username);

      // Team existence check (try both raw and canonical)
      const teamKeyRaw = `${PREFIX}:team:${username}`;
      const teamKeyCanon = `${PREFIX}:team:${c}`;

      let teamExists = false;

      const teamGetRaw = await redis.get<any>(teamKeyRaw);
      const teamGetCanon = teamKeyRaw === teamKeyCanon ? null : await redis.get<any>(teamKeyCanon);
      if (teamGetRaw || teamGetCanon) teamExists = true;

      if (!teamExists) {
        const teamHashRaw = await redis.hgetall<Record<string, string>>(teamKeyRaw);
        const parsedRaw = parseHashTeam(teamHashRaw);
        const teamHashCanon = teamKeyRaw === teamKeyCanon ? null : await redis.hgetall<Record<string, string>>(teamKeyCanon);
        const parsedCanon = teamHashCanon ? parseHashTeam(teamHashCanon) : null;

        teamExists = !!parsedRaw || !!parsedCanon;
      }

      if (!teamExists) continue;

      let total = 0;

      const pointsKeys: string[] = [];
      const pointsValues: Array<number | null> = [];

      for (const gid of gameIds) {
        const key = `${PREFIX}:user:${c}:game:${gid}:points`;
        pointsKeys.push(key);

        const pts = await redis.get<number>(key);
        const num = Number(pts ?? 0);
        pointsValues.push(pts ?? null);

        total += Number.isFinite(num) ? num : 0;
      }

      rows.push({ username, total });

      debugPerUser.push({
        username,
        canon: c,
        teamKeyTried: [teamKeyRaw, teamKeyCanon].filter((v, i, a) => a.indexOf(v) === i),
        pointsKeys,
        pointsValues,
      });
    }

    rows.sort((a, b) => b.total - a.total);

    return res.status(200).json({
      rows,
      gamesFinalized: gameIds.length,
      debug: {
        discoveredUsers: rawUsers,
        canonUsers: rawUsers.map(canon),
        gameIds,
        perUser: debugPerUser,
      },
    });
  } catch (e: unknown) {
    console.error("LEADERBOARD_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}