import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../lib/redis";
import { getSessionFromReq } from "../lib/session";
import { fixtures, getCurrentEditableRound, isTeamChangesLocked } from "../server/src/data";

type FormationKey = "3-5-2" | "3-4-3" | "4-4-2" | "4-3-3" | "4-5-1" | "5-3-2" | "5-4-1";

type StarPlayers = {
  DEF?: number | null;
  MID?: number | null;
  FWD?: number | null;
};

type TransferState = {
  round: number;
  used: number;
  limit: number;
};

type SavedTeam = {
  squadIds?: number[];
  startingXIIds?: number[];
  benchIds?: number[];
  finalXIIds?: number[];
  finalBenchIds?: number[];
  formation?: FormationKey;
  starPlayerIds?: StarPlayers;
  transfers?: TransferState;
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
    const usernameLower = String(username).trim().toLowerCase();
    const key = `${PREFIX}:team:${username}`;

    if (req.method === "GET") {
      const data = ((await redis.get<SavedTeam>(key)) ?? null) as SavedTeam | null;

      if (!data) {
        return res.status(200).json({ data: null });
      }

      const finalized = await redis.smembers(`${PREFIX}:games_finalized`);
      const finalizedGameIds = finalized
        .map((x) => Number(x))
        .filter((n) => Number.isInteger(n) && n > 0);

      const finalizedRounds = Array.from(
        new Set(
          finalizedGameIds
            .map((gid) => fixtures.find((f) => f.id === gid)?.round)
            .filter((r): r is number => Number.isInteger(r))
        )
      ).sort((a, b) => a - b);

      const lastFinalizedRound =
        finalizedRounds.length > 0 ? finalizedRounds[finalizedRounds.length - 1] : null;

      const currentRound = getCurrentEditableRound();

      const finalXIIds =
        lastFinalizedRound == null
          ? undefined
          : ((await redis.get<number[]>(
            `${PREFIX}:user:${usernameLower}:gw:${lastFinalizedRound}:finalXI`
          )) ?? undefined);

      const finalBenchIds =
        lastFinalizedRound == null
          ? undefined
          : ((await redis.get<number[]>(
            `${PREFIX}:user:${usernameLower}:gw:${lastFinalizedRound}:finalBench`
          )) ?? undefined);

      const normalized: SavedTeam = {
        ...data,
        transfers:
          currentRound == null
            ? data.transfers
            : normalizeTransfers(data.transfers, currentRound),
        finalXIIds,
        finalBenchIds,
      };

     return res.status(200).json({
  data: normalized,
  debug: {
    username,
    usernameLower,
    lastFinalizedRound,
    finalXIIds,
    finalBenchIds,
  },
});
    }

    if (req.method === "POST") {
      const approxSize = JSON.stringify(req.body ?? {}).length;
      if (approxSize > 10_000) return res.status(413).json({ error: "Payload too large" });

      const result = validateTeamPayload(req.body);

      if (!result.ok) {
        return res.status(400).json({ error: ("error" in result ? result.error : "Invalid payload") });
      }

      const prev = ((await redis.get<SavedTeam>(key)) ?? {}) as SavedTeam;
      const nextPartial = result.data;

      const currentRound = getCurrentEditableRound();

      if (currentRound == null) {
        return res.status(500).json({ error: "Current round unavailable" });
      }

      const prevTransfers = normalizeTransfers(prev.transfers, currentRound);
      const oldSquadIds = prev.squadIds ?? [];
      const newSquadIds = nextPartial.squadIds ?? oldSquadIds;

      const squadChanged = !sameIds(oldSquadIds, newSquadIds);

      if (squadChanged && isTeamChangesLocked()) {
        return res.status(403).json({
          error: "Team changes are locked after the first kickoff of the round",
        });
      }

      let transfersMade = 0;

      if (squadChanged) {
        const isInitialSave = oldSquadIds.length === 0 && newSquadIds.length === 15;

        if (isInitialSave) {
          transfersMade = 0;
        } else {
          transfersMade = countTransfers(oldSquadIds, newSquadIds);
        }

        if (prevTransfers.used + transfersMade > prevTransfers.limit) {
          return res.status(400).json({
            error: `Transfer limit reached. Remaining: ${Math.max(0, prevTransfers.limit - prevTransfers.used)}`,
          });
        }
      }

      const next: SavedTeam = {
        ...prev,
        ...nextPartial,
        transfers: {
          round: currentRound,
          used: prevTransfers.used + transfersMade,
          limit: 3,
        },
      };

      await redis.set(key, next);

      return res.status(200).json({
        ok: true,
        data: next,
      });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (e: unknown) {
    console.error("USER_TEAM_CRASH", e);
    const message = e instanceof Error ? e.message : "Server error";
    return res.status(500).json({ error: message });
  }
}

function normalizeTransfers(
  transfers: Partial<TransferState> | undefined,
  currentRound: number
): TransferState {
  const round = transfers?.round;
  const used = transfers?.used ?? 0;
  const limit = transfers?.limit ?? 3;

  if (round !== currentRound) {
    return {
      round: currentRound,
      used: 0,
      limit: 3,
    };
  }

  return {
    round: currentRound,
    used,
    limit,
  };
}

function countTransfers(oldSquadIds: number[], newSquadIds: number[]) {
  if (oldSquadIds.length === 0 && newSquadIds.length === 15) {
    return 0;
  }

  if (oldSquadIds.length !== newSquadIds.length) {
    throw new Error("Invalid transfer set");
  }

  const oldSet = new Set(oldSquadIds);
  const newSet = new Set(newSquadIds);

  const outgoing = oldSquadIds.filter((id) => !newSet.has(id));
  const incoming = newSquadIds.filter((id) => !oldSet.has(id));

  if (outgoing.length !== incoming.length) {
    throw new Error("Invalid transfer set");
  }

  return outgoing.length;
}

function sameIds(a: number[] = [], b: number[] = []) {
  if (a.length !== b.length) return false;
  const as = [...a].sort((x, y) => x - y);
  const bs = [...b].sort((x, y) => x - y);

  for (let i = 0; i < as.length; i++) {
    if (as[i] !== bs[i]) return false;
  }

  return true;
}