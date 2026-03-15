import type { VercelRequest, VercelResponse } from "@vercel/node";
import { players, fixtures } from "../server/src/data";
import { redis, PREFIX } from "../lib/redis";

type PlayerEventInput = {
  minutes?: "0" | "<60" | "60+";
  goals?: number;
  assists?: number;
  cleanSheet?: boolean;
  penMissed?: number;
  penSaved?: number;
  yellow?: number;
  red?: number;
  ownGoals?: number;
};

function calcPoints(
  position: "GK" | "DEF" | "MID" | "FWD",
  e?: PlayerEventInput
) {
  if (!e) return 0;

  let pts = 0;

  if (e.minutes === "<60") pts += 1;
  if (e.minutes === "60+") pts += 2;

  const goals = e.goals ?? 0;
  const assists = e.assists ?? 0;
  const cleanSheet = !!e.cleanSheet;
  const penMissed = e.penMissed ?? 0;
  const penSaved = e.penSaved ?? 0;
  const yellow = e.yellow ?? 0;
  const red = e.red ?? 0;
  const ownGoals = e.ownGoals ?? 0;

  if (position === "GK" || position === "DEF") pts += goals * 6;
  else if (position === "MID") pts += goals * 5;
  else pts += goals * 4;

  pts += assists * 3;

  if ((position === "GK" || position === "DEF") && cleanSheet) pts += 4;
  if (position === "MID" && cleanSheet) pts += 1;

  pts -= penMissed * 2;
  if (position === "GK") pts += penSaved * 5;
  pts -= yellow;
  pts -= red * 3;
  pts -= ownGoals * 2;

  return pts;
}

function getLastFinishedRound(): number | null {
  const now = Date.now();

  const rounds = Array.from(
    new Set(
      fixtures
        .map((f) => f.round)
        .filter((r): r is number => typeof r === "number")
    )
  ).sort((a, b) => a - b);

  let lastFinished: number | null = null;

  for (const round of rounds) {
    const times = fixtures
      .filter((f) => f.round === round)
      .map((f) => new Date(f.date).getTime())
      .filter((t) => Number.isFinite(t));

    if (times.length === 0) continue;

    const lastKickoff = Math.max(...times);
    if (now > lastKickoff) {
      lastFinished = round;
    }
  }

  return lastFinished;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const round = getLastFinishedRound();

    if (!round) {
      return res.json(
        players.map((p) => ({
          ...p,
          lastGwPoints: 0,
        }))
      );
    }

    const gameKey = `${PREFIX}:game:${round}:events`;

    const gameStats =
      (await redis.get<Record<string, PlayerEventInput>>(gameKey)) ?? {};

    const playersWithPoints = players.map((p) => ({
      ...p,
      lastGwPoints: calcPoints(p.position, gameStats[String(p.id)]),
    }));

    return res.json(playersWithPoints);
  } catch (e) {
    console.error("PLAYERS_API_CRASH", e);

    return res.json(
      players.map((p) => ({
        ...p,
        lastGwPoints: 0,
      }))
    );
  }
}