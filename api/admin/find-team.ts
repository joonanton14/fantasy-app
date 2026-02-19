import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis } from "../../lib/redis";

const PREFIXES = ["fantasy", "Fantasy", "app", "kv", ""] as const;
const USERS = ["admin", "joona", "olli", "otto", "Admin", "JoonA", "JOONA"] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const hits: any[] = [];

  for (const p of PREFIXES) {
    for (const u of USERS) {
      const key = p ? `${p}:team:${u}` : `team:${u}`;
      const data = await redis.get(key);
      if (data) hits.push({ key, data });
    }
  }

  res.status(200).json({ ok: true, hitsCount: hits.length, hits });
}
