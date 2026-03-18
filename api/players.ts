import type { VercelRequest, VercelResponse } from "@vercel/node";
import { players, fixtures } from "../server/src/data";
import { redis, PREFIX } from "../lib/redis";

type PlayerEventInput = {
  minutes?: "0" | "1_59" | "60+";
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

  if (e.minutes === "1_59") pts += 1;
  if (e.minutes === "60+") pts += 2;

  const goals = e.goals ?? 0;
  const assists = e.assists ?? 0;
  const cleanSheet = !!e.cleanSheet;
  const penMissed = e.penMissed ?? 0;
  const penSaved = e.penSaved ?? 0;
  const yellow = e.yellow ?? 0;
  const red = e.red ?? 0;
  const ownGoals = e.ownGoals ?? 0;

  if (position === "GK") pts += goals * 10;
  else if (position === "DEF") pts += goals * 6;
  else if (position === "MID") pts += goals * 5;
  else pts += goals * 4;

  pts += assists * 3;

  if ((position === "GK" || position === "DEF") && cleanSheet) pts += 4;
  if (position === "MID" && cleanSheet) pts += 1;

  pts -= penMissed * 2;
  if (position === "GK") pts += penSaved * 3;
  pts -= yellow;
  pts -= red * 3;
  pts -= ownGoals * 2;

  return pts;
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const finalized = await redis.smembers(`${PREFIX}:games_finalized`);
    const finalizedGameIds = finalized
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);

    if (finalizedGameIds.length === 0) {
      return res.json(
        players.map((p) => ({
          ...p,
          lastGwPoints: 0,
        }))
      );
    }

    const lastGameId = finalizedGameIds[finalizedGameIds.length - 1];
    const lastFixture = fixtures.find((f) => f.id === lastGameId);
    const targetRound = lastFixture?.round ?? null;

    if (targetRound == null) {
      return res.json(
        players.map((p) => ({
          ...p,
          lastGwPoints: 0,
        }))
      );
    }

    const targetGameIds = finalizedGameIds.filter((gid) => {
      const fx = fixtures.find((f) => f.id === gid);
      return fx?.round === targetRound;
    });

    const pointsByPlayerId: Record<number, number> = {};

    for (const gameId of targetGameIds) {
      const gameKey = `${PREFIX}:game:${gameId}:events`;
      const gameStats =
        (await redis.get<Record<string, PlayerEventInput>>(gameKey)) ?? {};

      for (const p of players) {
        const pts = calcPoints(p.position, gameStats[String(p.id)]);
        pointsByPlayerId[p.id] = (pointsByPlayerId[p.id] ?? 0) + pts;
      }
    }

    return res.json(
      players.map((p) => ({
        ...p,
        lastGwPoints: pointsByPlayerId[p.id] ?? 0,
      }))
    );
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