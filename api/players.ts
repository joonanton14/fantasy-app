import type { VercelRequest, VercelResponse } from "@vercel/node";
import { players, fixtures } from "../server/src/data";
import { redis, PREFIX } from "../lib/redis";
import { calcPoints, type PlayerEventInput } from "../lib/scoring";

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