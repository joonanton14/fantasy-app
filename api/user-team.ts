import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "./lib/redis";
import { getSessionFromReq } from "./lib/session";

type SavedTeam = {
  startingXIIds: number[];
  benchIds: number[];
};

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

function validateTeamPayload(body: any): { ok: true; data: SavedTeam } | { ok: false; error: string } {
  const data = body?.data;
  if (!data || typeof data !== "object") return { ok: false, error: "Missing data" };

  const starting = data.startingXIIds;
  const bench = data.benchIds ?? [];

  if (!Array.isArray(starting)) return { ok: false, error: "startingXIIds must be an array" };
  if (!Array.isArray(bench)) return { ok: false, error: "benchIds must be an array" };

  if (starting.length > 11) return { ok: false, error: "startingXIIds max length is 11" };
  if (bench.length > 4) return { ok: false, error: "benchIds max length is 4" };

  if (!starting.every(isInt) || !bench.every(isInt)) return { ok: false, error: "Ids must be integers" };
  if ([...starting, ...bench].some((n) => n <= 0)) return { ok: false, error: "Ids must be positive" };

  const startingSet = new Set(starting);
  if (startingSet.size !== starting.length) return { ok: false, error: "startingXIIds must be unique" };

  const benchSet = new Set(bench);
  if (benchSet.size !== bench.length) return { ok: false, error: "benchIds must be unique" };

  // no overlap
  for (const id of bench) {
    if (startingSet.has(id)) return { ok: false, error: "benchIds cannot include Starting XI players" };
  }

  // bench composition: 1 GK + 3 field
  // (we can't know positions here without players dataset, so we validate shape only here)
  // We'll enforce the GK/field rule in the client UI (StartingXI component).
  // If you want server-side enforcement later, we can load players list on server too.

  return { ok: true, data: { startingXIIds: starting, benchIds: bench } };
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
      const approxSize = JSON.stringify(req.body ?? {}).length;
      if (approxSize > 10_000) return res.status(413).json({ error: "Payload too large" });

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
