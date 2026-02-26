import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionFromReq } from "../../lib/session";
import { fixtures } from "../../server/src/data";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });

    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    return res.status(200).json({ fixtures });
  } catch (e: unknown) {
    console.error("FIXTURES_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}