import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";
import { getSessionFromReq } from "../../lib/session";

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (!session.isAdmin) return res.status(403).json({ error: "Forbidden" });

    // GET /api/admin/game-points?gameId=123
    if (req.method === "GET") {
      const gameId = Number(req.query.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) return res.status(400).json({ error: "Invalid gameId" });

      const key = `${PREFIX}:game:${gameId}:points`;
      const data = (await redis.get<Record<string, number>>(key)) ?? {};
      return res.status(200).json({ gameId, points: data });
    }

    // POST /api/admin/game-points { gameId, points }
    if (req.method === "POST") {
      const gameId = Number(req.body?.gameId);
      const points = req.body?.points;

      if (!Number.isInteger(gameId) || gameId <= 0) return res.status(400).json({ error: "Invalid gameId" });
      if (!points || typeof points !== "object") return res.status(400).json({ error: "points must be an object" });

      for (const [k, v] of Object.entries(points)) {
        const pid = Number(k);
        if (!Number.isInteger(pid) || pid <= 0) return res.status(400).json({ error: "Invalid player id in points" });
        if (!isInt(v)) return res.status(400).json({ error: "All point values must be integers" });
      }

      const key = `${PREFIX}:game:${gameId}:points`;
      await redis.set(key, points);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: unknown) {
    console.error("ADMIN_GAME_POINTS_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
