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

function normalizeUsername(u: string) {
  return u.trim().toLowerCase();
}

function coerceTeamFromHash(obj: any): TeamData | null {
  if (!obj || typeof obj !== "object") return null;

  const startingRaw = (obj.startingXIIds ?? obj.startingXI ?? obj.starting ?? null) as any;
  const benchRaw = (obj.benchIds ?? obj.bench ?? null) as any;
  const starRaw = (obj.starPlayerIds ?? obj.starPlayers ?? null) as any;

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
  const fromGet = (await redis.get<TeamData>(teamKey)) ?? null;
  if (fromGet && Array.isArray((fromGet as any).startingXIIds)) {
    return fromGet;
  }

  try {
    const h = (await (redis as any).hgetall(teamKey)) as any;
    return coerceTeamFromHash(h);
  } catch {
    return null;
  }
}

function mergeEvents(
  all: Record<string, PlayerEventInput>[]
): Record<string, PlayerEventInput> {
  const merged: Record<string, PlayerEventInput> = {};

  for (const gameEvents of all) {
    for (const [pid, ev] of Object.entries(gameEvents ?? {})) {
      if (!merged[pid]) {
        merged[pid] = {
          minutes: ev.minutes ?? "0",
          goals: Number(ev.goals ?? 0),
          assists: Number(ev.assists ?? 0),
          cleanSheet: Boolean(ev.cleanSheet),
          penMissed: Number(ev.penMissed ?? 0),
          penSaved: Number(ev.penSaved ?? 0),
          yellow: Number(ev.yellow ?? 0),
          red: Number(ev.red ?? 0),
          ownGoals: Number(ev.ownGoals ?? 0),
        };
      } else {
        const cur = merged[pid];

        if (cur.minutes === "60+" || ev.minutes === "60+") cur.minutes = "60+";
        else if (cur.minutes === "1_59" || ev.minutes === "1_59") cur.minutes = "1_59";
        else cur.minutes = "0";

        cur.goals += Number(ev.goals ?? 0);
        cur.assists += Number(ev.assists ?? 0);
        cur.penMissed += Number(ev.penMissed ?? 0);
        cur.penSaved += Number(ev.penSaved ?? 0);
        cur.yellow += Number(ev.yellow ?? 0);
        cur.red += Number(ev.red ?? 0);
        cur.ownGoals += Number(ev.ownGoals ?? 0);
        cur.cleanSheet = Boolean(cur.cleanSheet || ev.cleanSheet);
      }
    }
  }

  return merged;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session || !session.isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { round, gameIds } = req.body as { round: number; gameIds: number[] };
    if (!round || !Array.isArray(gameIds) || gameIds.length === 0) {
      return res.status(400).json({ error: "Invalid input" });
    }

    const playersById = new Map<number, PlayerLite>();
    for (const p of players) {
      playersById.set(p.id, { id: p.id, position: p.position });
    }

    const allEvents: Record<string, PlayerEventInput>[] = [];
    for (const gameId of gameIds) {
      const events =
        (await redis.get<Record<string, PlayerEventInput>>(`${PREFIX}:game:${gameId}:events`)) ?? {};
      allEvents.push(events);
    }

    const roundEventsById = mergeEvents(allEvents);

    const teamKeys = await redis.keys(`${PREFIX}:team:*`);
    const results: Array<{ username: string; points: number }> = [];

    for (const teamKey of teamKeys) {
      const username = normalizeUsername(teamKey.split(":").pop()!);
      const team = await loadTeam(teamKey);

      if (!team) {
        await redis.set(`${PREFIX}:user:${username}:gw:${round}:points`, 0);
        await redis.set(`${PREFIX}:user:${username}:gw:${round}:subs`, []);
        results.push({ username, points: 0 });
        continue;
      }

      const { total, subsUsed } = scoreTeamForGameWithAutosub({
        team,
        playersById,
        eventsById: roundEventsById,
      });

      await redis.set(`${PREFIX}:user:${username}:gw:${round}:points`, total);
      await redis.set(`${PREFIX}:user:${username}:gw:${round}:subs`, subsUsed);

      results.push({ username, points: total });
    }

    return res.json({ ok: true, round, results });
  } catch (e: unknown) {
    console.error("FINALIZE_ROUND_CRASH", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    });
  }
}