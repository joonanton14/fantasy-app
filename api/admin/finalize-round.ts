// api/admin/finalize-round.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";
import { getSessionFromReq } from "../../lib/session";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session = await getSessionFromReq(req);
  if (!session || !session.isAdmin) return res.status(403).json({ error: "Forbidden" });

  const { round, gameIds } = req.body as { round: number; gameIds: number[] };
  if (!round || !Array.isArray(gameIds) || gameIds.length === 0) {
    return res.status(400).json({ error: "Invalid input" });
  }

  const teamKeys = await redis.keys(`${PREFIX}:team:*`);
  const results: Array<{ username: string; points: number }> = [];

  for (const teamKey of teamKeys) {
    const username = teamKey.split(":").pop()!;
    let total = 0;

    for (const gameId of gameIds) {
      const p = await redis.get<number>(`${PREFIX}:user:${username}:game:${gameId}:points`);
      total += Number(p ?? 0);
    }

    await redis.set(`${PREFIX}:user:${username}:gw:${round}:points`, total);
    results.push({ username, points: total });
  }

  return res.json({ ok: true, round, results });
}