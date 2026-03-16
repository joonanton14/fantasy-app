import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";
import { getSessionFromReq } from "../../lib/session";
import {
  scoreTeamForRoundWithAutosub,
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

  const startingRaw = obj.startingXIIds ?? obj.startingXI ?? obj.starting ?? null;
  const benchRaw = obj.benchIds ?? obj.bench ?? null;
  const starsRaw = obj.starPlayerIds ?? null;

  const toNumArray = (v: any): number[] => {
    if (Array.isArray(v)) {
      return v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
    }

    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) {
          return parsed.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0);
        }
      } catch {}

      return v
        .split(",")
        .map((x) => Number(x.trim()))
        .filter((n) => Number.isInteger(n) && n > 0);
    }

    return [];
  };

  const parseStars = (v: any) => {
    if (!v) return {};

    const raw =
      typeof v === "string"
        ? (() => {
            try {
              return JSON.parse(v);
            } catch {
              return {};
            }
          })()
        : v;

    return {
      DEF: raw?.DEF == null ? null : Number(raw.DEF),
      MID: raw?.MID == null ? null : Number(raw.MID),
      FWD: raw?.FWD == null ? null : Number(raw.FWD),
    };
  };

  return {
    startingXIIds: toNumArray(startingRaw),
    benchIds: toNumArray(benchRaw),
    starPlayerIds: parseStars(starsRaw),
  };
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (!session.isAdmin) return res.status(403).json({ error: "Forbidden" });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { round, gameIds } = req.body as { round: number; gameIds: number[] };

    if (!round || !Array.isArray(gameIds) || gameIds.length === 0) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const cleanGameIds = Array.from(
      new Set(
        gameIds.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)
      )
    );

    if (cleanGameIds.length === 0) {
      return res.status(400).json({ error: "Invalid gameIds" });
    }

    const playersById = new Map<number, PlayerLite>();
    for (const p of players) {
      playersById.set(p.id, { id: p.id, position: p.position });
    }

    const roundPointsById: Record<string, number> = {};
    const roundPlayedById: Record<string, boolean> = {};

    for (const gameId of cleanGameIds) {
      const pointsKey = `${PREFIX}:game:${gameId}:points`;
      const eventsKey = `${PREFIX}:game:${gameId}:events`;

      const gamePoints = (await redis.get<Record<string, number>>(pointsKey)) ?? {};
      const gameEvents = (await redis.get<Record<string, PlayerEventInput>>(eventsKey)) ?? {};

      for (const [pid, pts] of Object.entries(gamePoints)) {
        const n = Number(pts);
        if (!Number.isFinite(n)) continue;
        roundPointsById[pid] = (roundPointsById[pid] ?? 0) + n;
      }

      for (const [pid, ev] of Object.entries(gameEvents)) {
        if (ev && ev.minutes !== "0") {
          roundPlayedById[pid] = true;
        }
      }
    }

    const teamKeys = await scanAllTeamKeys();
    const results: Array<{
      username: string;
      points: number;
      subsUsed: number[];
      subsOut: number[];
      finalStartingXIIds: number[];
      finalBenchIds: number[];
    }> = [];

    const debug: Array<any> = [];

    for (const teamKey of teamKeys) {
      const usernamePart = String(teamKey).split(":").pop() ?? "";
      const username = normalizeUsername(usernamePart);

      const { team, redisType } = await loadTeam(teamKey);

      const safeTeam: TeamData = {
        startingXIIds: team?.startingXIIds ?? [],
        benchIds: team?.benchIds ?? [],
        starPlayerIds: team?.starPlayerIds ?? {},
      };

      const scored = scoreTeamForRoundWithAutosub({
        team: safeTeam,
        playersById,
        roundPointsById,
        roundPlayedById,
      });

      await redis.set(`${PREFIX}:user:${username}:gw:${round}:points`, scored.total);
      await redis.set(`${PREFIX}:user:${username}:gw:${round}:subs`, scored.subsUsed);
      await redis.set(`${PREFIX}:user:${username}:gw:${round}:subsOut`, scored.subsOut);
      await redis.set(`${PREFIX}:user:${username}:gw:${round}:finalXI`, scored.finalStartingXIIds);
      await redis.set(`${PREFIX}:user:${username}:gw:${round}:finalBench`, scored.finalBenchIds);

      results.push({
        username,
        points: scored.total,
        subsUsed: scored.subsUsed,
        subsOut: scored.subsOut,
        finalStartingXIIds: scored.finalStartingXIIds,
        finalBenchIds: scored.finalBenchIds,
      });

      debug.push({
        username,
        teamKey,
        redisType,
        teamExists: !!team,
        startingLen: safeTeam.startingXIIds.length,
        benchLen: safeTeam.benchIds.length,
        stars: safeTeam.starPlayerIds ?? {},
      });
    }

    return res.status(200).json({
      ok: true,
      round,
      gameIds: cleanGameIds,
      results,
      debug: {
        discoveredTeamKeysCount: teamKeys.length,
        discoveredTeamKeys: teamKeys.slice(0, 50),
        perUserDebug: debug.slice(0, 50),
      },
    });
  } catch (e: unknown) {
    console.error("FINALIZE_ROUND_CRASH", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    });
  }
}