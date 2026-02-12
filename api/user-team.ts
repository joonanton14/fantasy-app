import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis";
import { getSessionFromReq } from "../lib/session";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });

    const username = session.username; // don’t accept username from query anymore
    const key = `${PREFIX}:team:${username}`;

    if (req.method === "GET") {
      const data = await redis.get(key);
      return res.status(200).json({ data: data ?? null });
    }

    if (req.method === "POST") {
      const body = req.body as any;
      const data = body?.data ?? null;
      await redis.set(key, data);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return res.status(500).json({ error: message });
  }
}
