import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";
import { getSessionFromReq } from "../../lib/session";
import {
  scoreTeamForGameWithAutosub,
  type TeamData,
  type PlayerLite,
  type PlayerEventInput,
} from "../../lib/scoring";

import { players } from "../../server/src/data";

type ScanReply = [string, string[]];

function normalizeUsername(u: string) {
  return u.trim().toLowerCase();
}

async function scanAllTeamKeys(): Promise<string[]> {
  const match = `${PREFIX}:team:*`;
  let cursor = "0";
  const keysAll: string[] = [];

  while (true) {
    const reply = (await (redis as any).scan(cursor, { match, count: 200 })) as ScanReply;
    const nextCursor: string = reply[0];
    const keys: string[] = reply[1] ?? [];
    keysAll.push(...keys);
    cursor = nextCursor;
    if (cursor === "0") break;
  }

  return Array.from(new Set(keysAll));
}

function coerceTeamFromHash(obj: any): TeamData | null {
  if (!obj || typeof obj !== "object") return null;

  const startingRaw = (obj.startingXIIds ?? obj.startingXI ?? obj.starting ?? null) as any;
  const benchRaw = (obj.benchIds ?? obj.bench ?? null) as any;

  const toNumArray = (v: any): number[] => {
    if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) return parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n));
      } catch {}
      return v
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isFinite(n));
    }
    return [];
  };

  const startingXIIds = toNumArray(startingRaw);
  const benchIds = toNumArray(benchRaw);

  return { startingXIIds, benchIds };
}

async function loadTeam(teamKey: string): Promise<{ team: TeamData | null; redisType: string | null }> {
  const fromGet = (await redis.get<TeamData>(teamKey)) ?? null;
  if (fromGet && Array.isArray((fromGet as any).startingXIIds)) {
    return { team: fromGet, redisType: "string/json(get)" };
  }

  let t: string | null = null;
  try {
    t = (await (redis as any).type(teamKey)) as string;
  } catch {
    t = null;
  }

  try {
    const h = (await (redis as any).hgetall(teamKey)) as any;
    const coerced = coerceTeamFromHash(h);
    if (coerced) return { team: coerced, redisType: t ?? "hash(hgetall)" };
  } catch {}

  return { team: null, redisType: t };
}

function toIntArray(v: any): number[] {
  if (!Array.isArray(v)) return [];
  const out: number[] = [];
  for (const x of v) {
    const n = Number(x);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (!session.isAdmin) return res.status(403).json({ error: "Forbidden" });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    // ✅ Accept either single game or multiple games (gameweek)
    const singleGameId = Number(req.body?.gameId);
    const gameIdsFromBody = toIntArray(req.body?.gameIds);

    const round = req.body?.round;
    const roundNum = Number.isInteger(Number(round)) ? Number(round) : null;
    const roundField = roundNum ? `gw:${roundNum}` : null;

    const gameIds =
      gameIdsFromBody.length > 0
        ? gameIdsFromBody
        : Number.isInteger(singleGameId) && singleGameId > 0
          ? [singleGameId]
          : [];

    if (gameIds.length === 0) {
      return res.status(400).json({ error: "Provide gameId or gameIds[]" });
    }

    // Load players map once
    const playersById = new Map<number, PlayerLite>();
    for (const p of players) playersById.set(p.id, { id: p.id, position: p.position });

    const teamKeys = await scanAllTeamKeys();

    // per user accumulators
    type PerGame = { gameId: number; points: number; subsUsed: number[] };
    const acc = new Map<string, { sum: number; perGame: PerGame[] }>();

    const perUserDebug: Array<any> = [];

    // compute all requested games
    for (const gameId of gameIds) {
      const eventsKey = `${PREFIX}:game:${gameId}:events`;
      const eventsById = (await redis.get<Record<string, PlayerEventInput>>(eventsKey)) ?? {};

      for (const teamKey of teamKeys) {
        const usernamePart = String(teamKey).split(":").pop() ?? "";
        const username = normalizeUsername(usernamePart);

        const { team, redisType } = await loadTeam(teamKey);
        const startingXIIds = team?.startingXIIds ?? [];
        const benchIds = team?.benchIds ?? [];

        const { total, subsUsed } = scoreTeamForGameWithAutosub({
          team: { startingXIIds, benchIds },
          playersById,
          eventsById,
        });

        // store per-game (same as before)
        await redis.set(`${PREFIX}:user:${username}:game:${gameId}:points`, total);
        await redis.set(`${PREFIX}:user:${username}:game:${gameId}:subs`, subsUsed);

        // accumulate per user for round sum
        const cur = acc.get(username) ?? { sum: 0, perGame: [] as PerGame[] };
        cur.sum += total;
        cur.perGame.push({ gameId, points: total, subsUsed });
        acc.set(username, cur);

        // lightweight debug (only once per user total loop is huge; keep minimal)
        if (gameId === gameIds[0]) {
          perUserDebug.push({
            username,
            teamKey,
            redisType,
            teamExists: !!team,
            startingLen: startingXIIds.length,
            benchLen: benchIds.length,
          });
        }
      }

      // mark each game finalized
      await redis.sadd(`${PREFIX}:games_finalized`, String(gameId));
    }

    // response
    const results = Array.from(acc.entries()).map(([username, v]) => ({
      username,
      points: v.sum,
      perGame: v.perGame.sort((a, b) => a.gameId - b.gameId),
    }));

    return res.status(200).json({
      ok: true,
      mode: gameIds.length === 1 ? "single" : "multi",
      gameIds,
      round: roundNum ?? null,
      results,
      debug: {
        prefix: PREFIX,
        playersByIdSize: playersById.size,
        discoveredTeamKeysCount: teamKeys.length,
        discoveredTeamKeys: teamKeys.slice(0, 50),
        perUserDebug: perUserDebug.slice(0, 50),
      },
    });
  } catch (e: unknown) {
    console.error("FINALIZE_GAME_CRASH", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    });
  }
}