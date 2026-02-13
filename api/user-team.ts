import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "./lib/redis";
import { getSessionFromReq } from "./lib/session";

type SavedTeam = {
  startingXIIds: number[];
};

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

function validateTeamPayload(body: any): { ok: true; data: SavedTeam } | { ok: false; error: string } {
  const data = body?.data;

  if (!data || typeof data !== "object") return { ok: false, error: "Missing data" };

  const ids = data.startingXIIds;

  if (!Array.isArray(ids)) return { ok: false, error: "startingXIIds must be an array" };
  if (ids.length > 11) return { ok: false, error: "startingXIIds max length is 11" };

  // If you want to require exactly 11 when saving, uncomment:
  // if (ids.length !== 11) return { ok: false, error: "startingXIIds must have exactly 11 players" };

  if (!ids.every(isInt)) return { ok: false, error: "startingXIIds must contain integers" };

  // Reject negatives / 0 if your player IDs start at 1
  if (ids.some((n) => n <= 0)) return { ok: false, error: "startingXIIds must be positive" };

  const uniq = new Set(ids);
  if (uniq.size !== ids.length) return { ok: false, error: "startingXIIds must be unique" };

  return { ok: true, data: { startingXIIds: ids } };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });

    const username = session.username;
    const key = `${PREFIX}:team:${username}`;

    if (req.method === "GET") {
      const data = await redis.get(key);
      return res.status(200).json({ data: data ?? null });
    }

    if (req.method === "POST") {
      // Basic payload size check (prevents huge JSON abuse)
      const approxSize = JSON.stringify(req.body ?? {}).length;
      if (approxSize > 10_000) {
        return res.status(413).json({ error: "Payload too large" });
      }

      const result = validateTeamPayload(req.body);
      if (!result.ok) return res.status(400).json({ error: result.error });

      await redis.set(key, result.data);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: unknown) {
    console.error("USER_TEAM_CRASH", e);
    const message = e instanceof Error ? e.message : "Server error";
    return res.status(500).json({ error: message });
  }
}
