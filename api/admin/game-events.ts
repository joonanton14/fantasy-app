import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";
import { getSessionFromReq } from "../../lib/session";
import { DEFAULT_EVENTS, type PlayerEventInput } from "../../lib/scoring";

function isPlainObject(x: unknown): x is Record<string, any> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

function normalizeEvent(input: any): PlayerEventInput {
  const ev = { ...DEFAULT_EVENTS, ...(isPlainObject(input) ? input : {}) };

  // Hard normalize minutes to your allowed buckets
  if (ev.minutes !== "0" && ev.minutes !== "1_59" && ev.minutes !== "60+") {
    ev.minutes = "0";
  }

  // Force numeric fields to integers >= 0 (or allow negatives if you want)
  const int0 = (v: any) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.trunc(n) : 0;
  };

  ev.goals = int0(ev.goals);
  ev.assists = int0(ev.assists);
  ev.penMissed = int0(ev.penMissed);
  ev.penSaved = int0(ev.penSaved);
  ev.yellow = int0(ev.yellow);
  ev.red = int0(ev.red);
  ev.ownGoals = int0(ev.ownGoals);
  ev.cleanSheet = Boolean(ev.cleanSheet);

  return ev;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (!session.isAdmin) return res.status(403).json({ error: "Forbidden" });

    const gameId = Number((req.method === "GET" ? req.query?.gameId : req.body?.gameId));
    if (!Number.isInteger(gameId) || gameId <= 0) {
      return res.status(400).json({ error: "Invalid gameId" });
    }

    const key = `${PREFIX}:game:${gameId}:events`;

    if (req.method === "GET") {
      const eventsById = (await redis.get<Record<string, PlayerEventInput>>(key)) ?? {};
      return res.status(200).json({ ok: true, gameId, eventsById });
    }

    if (req.method === "POST") {
      // Expect frontend to send: { gameId, eventsById: { "123": {...}, "124": {...} } }
      const raw = req.body?.eventsById ?? req.body?.events ?? req.body?.data;

      if (!isPlainObject(raw)) {
        return res.status(400).json({ error: "Missing eventsById object in body" });
      }

      const normalized: Record<string, PlayerEventInput> = {};
      for (const [pid, ev] of Object.entries(raw)) {
        // keep only numeric-ish ids
        const idNum = Number(pid);
        if (!Number.isInteger(idNum) || idNum <= 0) continue;
        normalized[String(idNum)] = normalizeEvent(ev);
      }

      await redis.set(key, normalized);

      return res.status(200).json({
        ok: true,
        gameId,
        savedPlayers: Object.keys(normalized).length,
      });
    }

    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: unknown) {
    console.error("GAME_EVENTS_CRASH", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    });
  }
}
