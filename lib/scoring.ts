// api/lib/scoring.ts
export type Position = "GK" | "DEF" | "MID" | "FWD";

export type PlayerLite = { id: number; position: Position };

export type TeamData = {
  startingXIIds: number[]; // 11
  benchIds: number[]; // 4: [GK, out1, out2, out3] (order matters)
};

export type MinutesBucket = "0" | "1_59" | "60+";

export type PlayerEventInput = {
  minutes: MinutesBucket;
  goals: number;
  assists: number;
  cleanSheet: boolean;
  penMissed: number;
  penSaved: number; // only GK typically
  yellow: number;
  red: number;
  ownGoals: number;
};

export const DEFAULT_EVENTS: PlayerEventInput = {
  minutes: "0",
  goals: 0,
  assists: 0,
  cleanSheet: false,
  penMissed: 0,
  penSaved: 0,
  yellow: 0,
  red: 0,
  ownGoals: 0,
};

const LIMITS = {
  DEF: { min: 3, max: 5 },
  MID: { min: 3, max: 5 },
  FWD: { min: 1, max: 3 },
} as const;

function played(ev?: PlayerEventInput | null) {
  return !!ev && ev.minutes !== "0";
}

export function calcPoints(pos: Position, ev: PlayerEventInput): number {
  let pts = 0;

  // minutes played
  if (ev.minutes === "1_59") pts += 1;
  if (ev.minutes === "60+") pts += 2;

  // goals
  if (ev.goals > 0) {
    if (pos === "GK") pts += ev.goals * 10;
    else if (pos === "DEF") pts += ev.goals * 6;
    else if (pos === "MID") pts += ev.goals * 5;
    else pts += ev.goals * 4; // FWD
  }

  // assists
  pts += ev.assists * 3;

  // clean sheets
  if (ev.cleanSheet) {
    if (pos === "GK" || pos === "DEF") pts += 4;
    else if (pos === "MID") pts += 1;
  }

  // pens
  pts += ev.penSaved * (pos === "GK" ? 3 : 0);
  pts += ev.penMissed * -2;

  // discipline / misc
  pts += ev.yellow * -1;
  pts += ev.red * -3;
  pts += ev.ownGoals * -2;

  return pts;
}

type Counts = { GK: number; DEF: number; MID: number; FWD: number };
function emptyCounts(): Counts {
  return { GK: 0, DEF: 0, MID: 0, FWD: 0 };
}
function addCount(c: Counts, pos: Position, delta: number) {
  c[pos] += delta;
}

function withinMax(c: Counts) {
  if (c.GK > 1) return false;
  if (c.DEF > LIMITS.DEF.max) return false;
  if (c.MID > LIMITS.MID.max) return false;
  if (c.FWD > LIMITS.FWD.max) return false;
  return true;
}

function canReachMins(c: Counts, remainingSlots: number) {
  const needDEF = Math.max(0, LIMITS.DEF.min - c.DEF);
  const needMID = Math.max(0, LIMITS.MID.min - c.MID);
  const needFWD = Math.max(0, LIMITS.FWD.min - c.FWD);
  return needDEF + needMID + needFWD <= remainingSlots;
}

/**
 * Bench order + formation constraints autosub.
 * - Replace DNP starters with bench players that played
 * - Only accept a bench player if it doesn't violate max
 *   AND still allows reaching mins with remaining subs.
 */
export function scoreTeamForGameWithAutosub(args: {
  team: TeamData;
  playersById: Map<number, PlayerLite>;
  eventsById: Record<string, PlayerEventInput>;
}) {
  const { team, playersById, eventsById } = args;

  const starters = team.startingXIIds ?? [];
  const bench = team.benchIds ?? [];

  const counts = emptyCounts();
  const usedSubs = new Set<number>();
  let total = 0;

  // DNP outfield starters by pos
  const dnpOutfield: Record<"DEF" | "MID" | "FWD", number[]> = { DEF: [], MID: [], FWD: [] };

  // --- starters (outfield first) ---
  for (const sid of starters) {
    const sp = playersById.get(sid);
    if (!sp) continue;

    const ev = eventsById[String(sid)];

    if (sp.position === "GK") continue;

    if (played(ev)) {
      addCount(counts, sp.position, 1);
      total += calcPoints(sp.position, ev);
    } else {
      dnpOutfield[sp.position].push(sid);
    }
  }

  // --- GK slot ---
  const starterGK = starters.find((id) => playersById.get(id)?.position === "GK") ?? null;
  const benchGK = bench.find((id) => playersById.get(id)?.position === "GK") ?? null;

  if (starterGK) {
    const ev = eventsById[String(starterGK)];
    if (played(ev)) {
      addCount(counts, "GK", 1);
      total += calcPoints("GK", ev);
    } else if (benchGK) {
      const bev = eventsById[String(benchGK)];
      if (played(bev)) {
        usedSubs.add(benchGK);
        addCount(counts, "GK", 1);
        total += calcPoints("GK", bev);
      }
    }
  }

  // --- bench outfield in order ---
  const benchOutfield = bench.filter((id) => playersById.get(id)?.position !== "GK");

  for (const bid of benchOutfield) {
    if (usedSubs.has(bid)) continue;

    const bp = playersById.get(bid);
    if (!bp || bp.position === "GK") continue;

    const bev = eventsById[String(bid)];
    if (!played(bev)) continue;

    const missingNow = dnpOutfield.DEF.length + dnpOutfield.MID.length + dnpOutfield.FWD.length;
    if (missingNow <= 0) break;

    // try add this bench player
    const next: Counts = { ...counts };
    addCount(next, bp.position, 1);

    // max rule
    if (!withinMax(next)) continue;

    // must still be possible to satisfy mins with remaining subs
    const remainingSlots = missingNow - 1;
    if (!canReachMins(next, remainingSlots)) continue;

    // consume one DNP starter slot (prefer same position, otherwise any)
    const order =
      bp.position === "DEF" ? (["DEF", "MID", "FWD"] as const)
      : bp.position === "MID" ? (["MID", "DEF", "FWD"] as const)
      : (["FWD", "MID", "DEF"] as const);

    let replaced: "DEF" | "MID" | "FWD" | null = null;
    for (const pos of order) {
      if (dnpOutfield[pos].length > 0) {
        replaced = pos;
        break;
      }
    }
    if (!replaced) {
      // no missing starter? (shouldn't happen)
      continue;
    }

    dnpOutfield[replaced].shift();
    counts.DEF = next.DEF;
    counts.MID = next.MID;
    counts.FWD = next.FWD;

    usedSubs.add(bid);
    total += calcPoints(bp.position, bev);
  }

  return { total, subsUsed: Array.from(usedSubs), counts };
}
