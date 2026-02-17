import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis"; // if this file is /api/leaderboard.ts
// if this file is /api/admin/leaderboard.ts, use "../lib/redis"

const USERS = ["admin", "joona", "olli", "otto"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    const gameIdsRaw = (await redis.smembers(`${PREFIX}:games_finalized`)) ?? [];
    const gameIds = gameIdsRaw
      .map((x) => Number(x))
      .filter((n) => Number.isInteger(n) && n > 0)
      .sort((a, b) => a - b);

    const leaderboard = await Promise.all(
      USERS.map(async (username) => {
        const perGame: Record<string, number> = {};
        let total = 0;

        for (const gid of gameIds) {
          const key = `${PREFIX}:user:${username}:game:${gid}:points`;
          const pts = (await redis.get<number>(key)) ?? 0;
          const n = Number(pts) || 0;
          perGame[String(gid)] = n;
          total += n;
        }

        return { username, total, perGame };
      })
    );

    leaderboard.sort((a, b) => b.total - a.total);

    return res.status(200).json({ ok: true, gameIds, leaderboard });
  } catch (e: unknown) {
    console.error("LEADERBOARD_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
