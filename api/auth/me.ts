import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getSessionFromReq } from "../lib/session";

function addCors(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === "OPTIONS") {
      addCors(req, res);
      return res.status(204).end();
    }

    addCors(req, res);

    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });

    // If you want stable IDs, map usernames -> ids here
    // For now: return name + isAdmin (your UI mainly needs these)
    return res.status(200).json({ name: session.username, isAdmin: session.isAdmin });
  } catch (e: unknown) {
    console.error("AUTH_ME_CRASH", e);
    return res.status(500).json({ error: e instanceof Error ? e.message : "Server error" });
  }
}
