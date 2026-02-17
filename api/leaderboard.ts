import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis";

const USERS = ["admin", "joona", "olli", "otto"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return res.status(405).json({ error: "Method not allowed" });
    }

    // Example: sum points over all finalized games
    const gameIds = (await redis.smembers(`${PREFIX}:games_finalized`)) ?? [];

    const rows = await Promise.all(
      USERS.map(async (username) => {
        let total = 0;
        for (const gid of gameIds) {
          const pts =
            (await redis.get<number>(`${PREFIX}:user:${username}:game:${gid}:points`)) ?? 0;
          total += Number(pts) || 0;
        }
        return { username, total };
      })
    );

    rows.sort((a, b) => b.total - a.total);
    return res.status(200).json({ ok: true, games: gameIds.map(Number), leaderboard: rows });
  } catch (e: unknown) {
    console.error("LEADERBOARD_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
