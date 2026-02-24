// api/user-team.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis";
import { getSessionFromReq } from "../lib/session";

type FormationKey = "3-5-2" | "3-4-3" | "4-4-2" | "4-3-3" | "4-5-1" | "5-3-2" | "5-4-1";

type SavedTeam = {
  startingXIIds: number[];
  benchIds: number[];
  formation?: FormationKey; // ✅ NEW
};

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

function isFormationKey(v: unknown): v is FormationKey {
  return (
    v === "3-5-2" ||
    v === "3-4-3" ||
    v === "4-4-2" ||
    v === "4-3-3" ||
    v === "4-5-1" ||
    v === "5-3-2" ||
    v === "5-4-1"
  );
}

function validateTeamPayload(body: any): { ok: true; data: SavedTeam } | { ok: false; error: string } {
  const data = body?.data;
  if (!data || typeof data !== "object") return { ok: false, error: "Missing data" };

  const starting = data.startingXIIds;
  const bench = data.benchIds ?? [];
  const formation = data.formation;

  if (!Array.isArray(starting)) return { ok: false, error: "startingXIIds must be an array" };
  if (!Array.isArray(bench)) return { ok: false, error: "benchIds must be an array" };

  if (starting.length > 15) return { ok: false, error: "startingXIIds max length is 15" };
  if (bench.length > 4) return { ok: false, error: "benchIds max length is 4" };

  if (!starting.every(isInt) || !bench.every(isInt)) return { ok: false, error: "Ids must be integers" };
  if ([...starting, ...bench].some((n) => n <= 0)) return { ok: false, error: "Ids must be positive" };

  const startingSet = new Set(starting);
  if (startingSet.size !== starting.length) return { ok: false, error: "startingXIIds must be unique" };

  const benchSet = new Set(bench);
  if (benchSet.size !== bench.length) return { ok: false, error: "benchIds must be unique" };

  for (const id of bench) {
    if (startingSet.has(id)) return { ok: false, error: "benchIds cannot include Starting XI players" };
  }

  if (formation !== undefined && !isFormationKey(formation)) {
    return { ok: false, error: "Invalid formation" };
  }

  return { ok: true, data: { startingXIIds: starting, benchIds: bench, formation } };
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