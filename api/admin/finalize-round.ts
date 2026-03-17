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
    const reply = (await (redis as any).scan(cursor, {
      match,
      count: 200,
    })) as ScanReply;

    const nextCursor = reply[0];
    const keys = reply[1] ?? [];

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
  const starRaw = obj.starPlayerIds ?? obj.starPlayers ?? null;

  const toNumArray = (v: any): number[] => {
    if (Array.isArray(v)) {
      return v.map(Number).filter(Number.isFinite);
    }

    if (typeof v === "string") {
      try {
        const parsed = JSON.parse(v);
        if (Array.isArray(parsed)) {
          return parsed.map(Number).filter(Number.isFinite);
        }
      } catch {}

      return v
        .split(",")
        .map((x) => Number(x.trim()))
        .filter(Number.isFinite);
    }

    return [];
  };

  const parseStars = (v: any) => {
    if (!v) return undefined;
    if (typeof v === "object") return v;

    if (typeof v === "string") {
      try {
        return JSON.parse(v);
      } catch {
        return undefined;
      }
    }

    return undefined;
  };

  return {
    startingXIIds: toNumArray(startingRaw),
    benchIds: toNumArray(benchRaw),
    starPlayerIds: parseStars(starRaw),
  };
}

async function loadTeam(teamKey: string): Promise<TeamData | null> {
  const fromGet = await redis.get<TeamData>(teamKey);

  if (fromGet && Array.isArray((fromGet as any).startingXIIds)) {
    return fromGet;
  }

  try {
    const h = await (redis as any).hgetall(teamKey);
    return coerceTeamFromHash(h);
  } catch {
    return null;
  }
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

function mergeEvents(
  all: Record<string, PlayerEventInput>[]
): Record<string, PlayerEventInput> {
  const merged: Record<string, PlayerEventInput> = {};

  for (const gameEvents of all) {
    for (const [pid, ev] of Object.entries(gameEvents ?? {})) {
      if (!merged[pid]) {
        merged[pid] = { ...ev };
      } else {
        const cur = merged[pid];

        if (cur.minutes === "60+" || ev.minutes === "60+") cur.minutes = "60+";
        else if (cur.minutes === "1_59" || ev.minutes === "1_59") cur.minutes = "1_59";
        else cur.minutes = "0";

        cur.goals += ev.goals ?? 0;
        cur.assists += ev.assists ?? 0;
        cur.penMissed += ev.penMissed ?? 0;
        cur.penSaved += ev.penSaved ?? 0;
        cur.yellow += ev.yellow ?? 0;
        cur.red += ev.red ?? 0;
        cur.ownGoals += ev.ownGoals ?? 0;
        cur.cleanSheet = cur.cleanSheet || ev.cleanSheet;
      }
    }
  }

  return merged;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);

    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (!session.isAdmin) return res.status(403).json({ error: "Forbidden" });
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const gameIds = toIntArray(req.body?.gameIds);
    const roundRaw = req.body?.round;
    const roundNum = Number.isInteger(Number(roundRaw)) ? Number(roundRaw) : null;

    if (!roundNum || gameIds.length === 0) {
      return res.status(400).json({ error: "Provide round and gameIds[]" });
    }

    const playersById = new Map<number, PlayerLite>();
    for (const p of players) {
      playersById.set(p.id, { id: p.id, position: p.position });
    }

    const allEvents: Record<string, PlayerEventInput>[] = [];
    for (const gameId of gameIds) {
      const events =
        (await redis.get<Record<string, PlayerEventInput>>(
          `${PREFIX}:game:${gameId}:events`
        )) ?? {};
      allEvents.push(events);
    }

    const roundEventsById = mergeEvents(allEvents);
    const teamKeys = await scanAllTeamKeys();

    const results: Array<{ username: string; points: number; subsUsed: number[] }> = [];

    for (const teamKey of teamKeys) {
      const username = normalizeUsername(String(teamKey).split(":").pop() ?? "");
      const team = await loadTeam(teamKey);

      if (!team) {
        await redis.set(`${PREFIX}:user:${username}:gw:${roundNum}:points`, 0);
        await redis.set(`${PREFIX}:user:${username}:gw:${roundNum}:subs`, []);
        results.push({ username, points: 0, subsUsed: [] });
        continue;
      }

      const { total, subsUsed } = scoreTeamForGameWithAutosub({
        team,
        playersById,
        eventsById: roundEventsById,
      });

      await redis.set(`${PREFIX}:user:${username}:gw:${roundNum}:points`, total);
      await redis.set(`${PREFIX}:user:${username}:gw:${roundNum}:subs`, subsUsed);

      results.push({ username, points: total, subsUsed });
    }

    for (const gameId of gameIds) {
      await redis.sadd(`${PREFIX}:games_finalized`, String(gameId));
    }

    return res.status(200).json({
      ok: true,
      round: roundNum,
      gameIds,
      results,
    });
  } catch (e: unknown) {
    console.error("FINALIZE_GAME_CRASH", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    });
  }
}