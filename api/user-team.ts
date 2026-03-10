import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis";
import { getSessionFromReq } from "../lib/session";
import { isTeamChangesLocked } from "../server/src/data";

type FormationKey = "3-5-2" | "3-4-3" | "4-4-2" | "4-3-3" | "4-5-1" | "5-3-2" | "5-4-1";

type StarPlayers = {
  DEF?: number | null;
  MID?: number | null;
  FWD?: number | null;
};

type SavedTeam = {
  squadIds?: number[];
  startingXIIds?: number[];
  benchIds?: number[];
  formation?: FormationKey;
  starPlayerIds?: StarPlayers;
};

function isPosKey(v: unknown): v is "DEF" | "MID" | "FWD" {
  return v === "DEF" || v === "MID" || v === "FWD";
}

function isNullablePositiveInt(v: unknown): v is number | null {
  return v === null || (typeof v === "number" && Number.isInteger(v) && v > 0);
}

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

function toNumArray(v: any): number[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => Number(x)).filter((n) => Number.isFinite(n) && Number.isInteger(n));
  return [];
}

function validateTeamPayload(body: any): { ok: true; data: SavedTeam } | { ok: false; error: string } {
  const data = body?.data;
  if (!data || typeof data !== "object") return { ok: false, error: "Missing data" };

  const squadIds = data.squadIds;
  const startingXIIds = data.startingXIIds;
  const benchIds = data.benchIds;
  const formation = data.formation;

  const starPlayerIds = data.starPlayerIds;
  const out: SavedTeam = {};

  const hasAnything =
    squadIds !== undefined ||
    startingXIIds !== undefined ||
    benchIds !== undefined ||
    formation !== undefined ||
    starPlayerIds !== undefined;

  if (starPlayerIds !== undefined) {
    if (!starPlayerIds || typeof starPlayerIds !== "object" || Array.isArray(starPlayerIds)) {
      return { ok: false, error: "starPlayerIds must be an object" };
    }

    const outStars: StarPlayers = {};

    for (const [k, v] of Object.entries(starPlayerIds)) {
      if (!isPosKey(k)) return { ok: false, error: "Invalid starPlayerIds key" };

      const parsed = v === "" ? null : v;
      const num = parsed === null ? null : Number(parsed);

      if (!(parsed === null || (typeof num === "number" && Number.isInteger(num) && num > 0))) {
        return { ok: false, error: `starPlayerIds.${k} must be a positive integer or null` };
      }

      outStars[k] = num;
    }

    out.starPlayerIds = outStars;
  }
  if (squadIds !== undefined) {
    if (!Array.isArray(squadIds)) return { ok: false, error: "squadIds must be an array" };

    const squad = toNumArray(squadIds);
    if (squad.length !== squadIds.length) return { ok: false, error: "squadIds must be integers" };
    if (squad.length !== 15) return { ok: false, error: "squadIds length must be 15" };
    if (squad.some((n) => n <= 0)) return { ok: false, error: "squadIds must be positive" };

    const set = new Set(squad);
    if (set.size !== squad.length) return { ok: false, error: "squadIds must be unique" };

    out.squadIds = squad;
  }

  // ---- formation validation (StartingXI page) ----
  if (formation !== undefined) {
    if (!isFormationKey(formation)) return { ok: false, error: "Invalid formation" };
    out.formation = formation;
  }

  // allow partial saves, but if one exists, validate shape
  if (startingXIIds !== undefined) {
    if (!Array.isArray(startingXIIds)) return { ok: false, error: "startingXIIds must be an array" };
    const xi = toNumArray(startingXIIds);
    if (xi.length !== startingXIIds.length) return { ok: false, error: "startingXIIds must be integers" };
    if (xi.length !== 11) return { ok: false, error: "startingXIIds length must be 11" };
    if (xi.some((n) => n <= 0)) return { ok: false, error: "startingXIIds must be positive" };
    const set = new Set(xi);
    if (set.size !== xi.length) return { ok: false, error: "startingXIIds must be unique" };
    out.startingXIIds = xi;
  }

  if (benchIds !== undefined) {
    if (!Array.isArray(benchIds)) return { ok: false, error: "benchIds must be an array" };
    const b = toNumArray(benchIds);
    if (b.length !== benchIds.length) return { ok: false, error: "benchIds must be integers" };
    if (b.length !== 4) return { ok: false, error: "benchIds length must be 4" };
    if (b.some((n) => n <= 0)) return { ok: false, error: "benchIds must be positive" };
    const set = new Set(b);
    if (set.size !== b.length) return { ok: false, error: "benchIds must be unique" };
    out.benchIds = b;
  }

  // if both XI and bench exist -> no overlap
  if (out.startingXIIds && out.benchIds) {
    const xiSet = new Set(out.startingXIIds);
    for (const id of out.benchIds) {
      if (xiSet.has(id)) return { ok: false, error: "benchIds cannot include Starting XI players" };
    }
  }

  // if squad exists + xi/bench exist -> ensure subset
  if (out.squadIds && (out.startingXIIds || out.benchIds)) {
    const squadSet = new Set(out.squadIds);
    const all = [...(out.startingXIIds ?? []), ...(out.benchIds ?? [])];
    for (const id of all) {
      if (!squadSet.has(id)) return { ok: false, error: "startingXIIds/benchIds must be within squadIds" };
    }
  }

  if (out.starPlayerIds && out.startingXIIds) {
    const xiSet = new Set(out.startingXIIds);

    for (const [pos, id] of Object.entries(out.starPlayerIds) as Array<["DEF" | "MID" | "FWD", number | null | undefined]>) {
      if (id == null) continue;
      if (!xiSet.has(id)) {
        return { ok: false, error: `starPlayerIds.${pos} must be in startingXIIds` };
      }
    }
  }

  return { ok: true, data: out };
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
      if (isTeamChangesLocked()) {
        return res.status(403).json({
          error: "Team changes are locked after the first kickoff of the round",
        });
      }
      
      const result = validateTeamPayload(req.body);

      if (!result.ok) {
        return res.status(400).json({ error: ("error" in result ? result.error : "Invalid payload") });
      }

      // merge with existing so partial updates don't erase other parts
      const prev = ((await redis.get<SavedTeam>(key)) ?? {}) as SavedTeam;
      const next: SavedTeam = { ...prev, ...result.data };

      await redis.set(key, next);
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: unknown) {
    console.error("USER_TEAM_CRASH", e);
    const message = e instanceof Error ? e.message : "Server error";
    return res.status(500).json({ error: message });
  }
}