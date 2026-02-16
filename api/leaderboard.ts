import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "./lib/redis";

type Team = { startingXIIds: number[]; benchIds?: number[] };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const gw = Number(req.query.gw);
    if (!Number.isInteger(gw) || gw <= 0) return res.status(400).json({ error: "Invalid gw" });

    const pointsKey = `${PREFIX}:gw:${gw}:points`;
    const points = (await redis.get<Record<string, number>>(pointsKey)) ?? {};

    // list all teams
    const teamKeys = await redis.keys(`${PREFIX}:team:*`);

    const rows = [];
    for (const key of teamKeys) {
      const username = key.split(`${PREFIX}:team:`)[1] || key;
      const team = (await redis.get<Team>(key)) ?? { startingXIIds: [] };

      const xi = team.startingXIIds ?? [];
      let total = 0;

      for (const id of xi) total += points[String(id)] ?? 0;

      rows.push({ username, total });
    }

    rows.sort((a, b) => b.total - a.total);
    return res.status(200).json({ gw, leaderboard: rows });
  } catch (e: unknown) {
    console.error("LEADERBOARD_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
