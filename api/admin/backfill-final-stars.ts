import type { VercelRequest, VercelResponse } from "@vercel/node";
import { redis, PREFIX } from "../../lib/redis";
import { getSessionFromReq } from "../../lib/session";
import { fixtures, players } from "../../server/src/data";
import { calcPoints, DEFAULT_EVENTS, type PlayerEventInput, type Position, type StarPlayers } from "../../lib/scoring";

type ScanReply = [string, string[]];

type TeamData = {
  starPlayerIds?: StarPlayers;
};

type BackfillResult = {
  username: string;
  round: number;
  status: "created" | "existing" | "ambiguous" | "unresolved" | "missing-data";
  stars?: StarPlayers;
  note?: string;
};

function normalizeUsername(u: string) {
  return String(u ?? "").trim().toLowerCase();
}

async function scanAllTeamKeys(): Promise<string[]> {
  const match = `${PREFIX}:team:*`;
  let cursor = "0";
  const keysAll: string[] = [];

  while (true) {
    const reply = (await (redis as any).scan(cursor, {
      match,
      count: 200,
    })) as ScanReply;

    const nextCursor = reply[0];
    const keys = reply[1] ?? [];

    keysAll.push(...keys);
    cursor = nextCursor;

    if (cursor === "0") break;
  }

  return Array.from(new Set(keysAll));
}

function parseStars(v: any): StarPlayers | undefined {
  if (!v) return undefined;
  if (typeof v === "object" && !Array.isArray(v)) return v as StarPlayers;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as StarPlayers;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

async function loadCurrentTeam(teamKey: string): Promise<TeamData | null> {
  const fromGet = await redis.get<TeamData>(teamKey);
  if (fromGet && typeof fromGet === "object") return fromGet;

  try {
    const h = await (redis as any).hgetall(teamKey);
    return { starPlayerIds: parseStars(h?.starPlayerIds ?? h?.starPlayers) };
  } catch {
    return null;
  }
}

function mergeEvents(all: Record<string, PlayerEventInput>[]): Record<string, PlayerEventInput> {
  const merged: Record<string, PlayerEventInput> = {};

  for (const gameEvents of all) {
    for (const [pid, rawEv] of Object.entries(gameEvents ?? {})) {
      const ev = { ...DEFAULT_EVENTS, ...rawEv };
      const cur = merged[pid] ?? { ...DEFAULT_EVENTS };

      if (cur.minutes === "60+" || ev.minutes === "60+") cur.minutes = "60+";
      else if (cur.minutes === "1_59" || ev.minutes === "1_59") cur.minutes = "1_59";
      else cur.minutes = "0";

      cur.goals += ev.goals ?? 0;
      cur.assists += ev.assists ?? 0;
      cur.penMissed += ev.penMissed ?? 0;
      cur.penSaved += ev.penSaved ?? 0;
      cur.yellow += ev.yellow ?? 0;
      cur.red += ev.red ?? 0;
      cur.ownGoals += ev.ownGoals ?? 0;
      cur.cleanSheet = cur.cleanSheet || !!ev.cleanSheet;

      merged[pid] = cur;
    }
  }

  return merged;
}

function bonusForPlayer(basePoints: number) {
  return Math.round(basePoints * 1.5) - basePoints;
}

function playerStarBonus(playerId: number, pos: Position, finalXIIds: number[], basePointsById: Map<number, number>) {
  if (!finalXIIds.includes(playerId)) return 0;
  if (pos === "GK") return 0;
  return bonusForPlayer(basePointsById.get(playerId) ?? 0);
}

function inferStarsFromTotal(args: {
  finalXIIds: number[];
  finalBenchIds: number[];
  roundTotal: number;
  basePointsById: Map<number, number>;
  positionsById: Map<number, Position>;
  preferredStars?: StarPlayers;
}): { stars?: StarPlayers; note?: string } {
  const { finalXIIds, finalBenchIds, roundTotal, basePointsById, positionsById, preferredStars } = args;

  const baseTotal = finalXIIds.reduce((sum, id) => sum + (basePointsById.get(id) ?? 0), 0);
  const bonusDelta = roundTotal - baseTotal;

  // Candidates include finalXI players AND bench players (autosub'd stars end up in bench).
  // Star bonus for a bench player returns 0 (they didn't play), so they only matter
  // for resolving ambiguous matches via preferredStars.
  const allCandidates = Array.from(new Set([...finalXIIds, ...finalBenchIds]));
  const defIds = allCandidates.filter((id) => positionsById.get(id) === "DEF");
  const midIds = allCandidates.filter((id) => positionsById.get(id) === "MID");
  const fwdIds = allCandidates.filter((id) => positionsById.get(id) === "FWD");

  const defChoices: Array<number | null> = [null, ...defIds];
  const midChoices: Array<number | null> = [null, ...midIds];
  const fwdChoices: Array<number | null> = [null, ...fwdIds];

  const matches: StarPlayers[] = [];

  for (const defId of defChoices) {
    const defBonus = defId == null ? 0 : playerStarBonus(defId, "DEF", finalXIIds, basePointsById);
    for (const midId of midChoices) {
      const midBonus = midId == null ? 0 : playerStarBonus(midId, "MID", finalXIIds, basePointsById);
      for (const fwdId of fwdChoices) {
        const fwdBonus = fwdId == null ? 0 : playerStarBonus(fwdId, "FWD", finalXIIds, basePointsById);
        if (defBonus + midBonus + fwdBonus === bonusDelta) {
          matches.push({ DEF: defId, MID: midId, FWD: fwdId });
        }
      }
    }
  }

  if (matches.length === 0) {
    return { note: `No star combination matched saved total delta ${bonusDelta}.` };
  }

  if (matches.length === 1) {
    return { stars: matches[0] };
  }

  const preferred = preferredStars ?? {};
  const preferredMatch = matches.find(
    (m) => Number(m.DEF ?? null) === Number(preferred.DEF ?? null) &&
      Number(m.MID ?? null) === Number(preferred.MID ?? null) &&
      Number(m.FWD ?? null) === Number(preferred.FWD ?? null)
  );

  if (preferredMatch) {
    return {
      stars: preferredMatch,
      note: `Resolved from ${matches.length} possible combinations using current saved star picks.`,
    };
  }

  return { note: `Found ${matches.length} possible star combinations; unable to choose safely.` };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const session = await getSessionFromReq(req);
    if (!session) return res.status(401).json({ error: "Unauthorized" });
    if (!session.isAdmin) return res.status(403).json({ error: "Forbidden" });
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const roundRaw = req.body?.round;
    const requestedRound = roundRaw === "all" || roundRaw == null ? null : Number(roundRaw);
    if (requestedRound != null && (!Number.isInteger(requestedRound) || requestedRound <= 0)) {
      return res.status(400).json({ error: "Invalid round" });
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

    const targetRounds = requestedRound == null
      ? finalizedRounds
      : finalizedRounds.filter((round) => round === requestedRound);

    if (targetRounds.length === 0) {
      return res.status(400).json({ error: requestedRound == null ? "No finalized rounds found" : `Round ${requestedRound} is not finalized` });
    }

    const teamKeys = await scanAllTeamKeys();
    const playersById = new Map(players.map((p) => [p.id, p] as const));
    const results: BackfillResult[] = [];

    for (const round of targetRounds) {
      const roundGameIds = finalizedGameIds.filter((gid) => fixtures.find((f) => f.id === gid)?.round === round);
      const allEvents = await Promise.all(
        roundGameIds.map(async (gid) => {
          const key = `${PREFIX}:game:${gid}:events`;
          return (await redis.get<Record<string, PlayerEventInput>>(key)) ?? {};
        })
      );
      const eventsById = mergeEvents(allEvents);
      const basePointsById = new Map<number, number>();
      const positionsById = new Map<number, Position>();

      for (const [id, player] of playersById) {
        positionsById.set(id, player.position);
        basePointsById.set(id, calcPoints(player.position, eventsById[String(id)] ?? DEFAULT_EVENTS));
      }

      for (const teamKey of teamKeys) {
        const username = normalizeUsername(String(teamKey).split(":").pop() ?? "");
        const finalStarsKey = `${PREFIX}:user:${username}:gw:${round}:finalStars`;
        const existing = await redis.get<StarPlayers>(finalStarsKey);

        if (existing && typeof existing === "object") {
          results.push({ username, round, status: "existing", stars: existing });
          continue;
        }

        const [finalXI, finalBench, roundTotal, currentTeam] = await Promise.all([
          redis.get<number[]>(`${PREFIX}:user:${username}:gw:${round}:finalXI`),
          redis.get<number[]>(`${PREFIX}:user:${username}:gw:${round}:finalBench`),
          redis.get<number | string>(`${PREFIX}:user:${username}:gw:${round}:points`),
          loadCurrentTeam(teamKey),
        ]);

        const finalXIIds = Array.isArray(finalXI)
          ? finalXI.map(Number).filter((n) => Number.isInteger(n) && n > 0)
          : [];
        const finalBenchIds = Array.isArray(finalBench)
          ? finalBench.map(Number).filter((n) => Number.isInteger(n) && n > 0)
          : [];
        const totalNum = Number(roundTotal);

        if (finalXIIds.length !== 11 || !Number.isFinite(totalNum)) {
          results.push({
            username,
            round,
            status: "missing-data",
            note: "Missing finalXI or round total.",
          });
          continue;
        }

        const inferred = inferStarsFromTotal({
          finalXIIds,
          finalBenchIds,
          roundTotal: totalNum,
          basePointsById,
          positionsById,
          preferredStars: currentTeam?.starPlayerIds,
        });

        if (!inferred.stars) {
          results.push({
            username,
            round,
            status: inferred.note?.includes("possible") ? "ambiguous" : "unresolved",
            note: inferred.note,
          });
          continue;
        }

        await redis.set(finalStarsKey, inferred.stars);
        results.push({
          username,
          round,
          status: "created",
          stars: inferred.stars,
          note: inferred.note,
        });
      }
    }

    const summary = results.reduce(
      (acc, row) => {
        acc[row.status] = (acc[row.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<BackfillResult["status"], number>
    );

    return res.status(200).json({
      ok: true,
      rounds: targetRounds,
      summary,
      results,
    });
  } catch (e: unknown) {
    console.error("BACKFILL_FINAL_STARS_CRASH", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Server error",
    });
  }
}
