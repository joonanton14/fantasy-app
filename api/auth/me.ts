import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionFromReq } from "../lib/session";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });

    return res.status(200).json({
      name: session.username,
      isAdmin: session.isAdmin,
    });
  } catch (e: unknown) {
    console.error("AUTH_ME_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
