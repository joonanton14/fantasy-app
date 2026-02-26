export type Position = "GK" | "DEF" | "MID" | "FWD";

export type PlayerLite = { id: number; position: Position };

export type TeamData = {
  startingXIIds: number[];
  benchIds: number[];
};

export type MinutesBucket = "0" | "1_59" | "60+";

export type PlayerEventInput = {
  minutes: MinutesBucket;
  goals: number;
  assists: number;
  cleanSheet: boolean;
  penMissed: number;
  penSaved: number;
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

export function scoreTeamForGameWithAutosub(args: {
  team: TeamData;
  playersById: Map<number, PlayerLite>;
  eventsById: Record<string, PlayerEventInput>;
}) {
  const { team, playersById, eventsById } = args;

  const starters = team.startingXIIds ?? [];
  const bench = team.benchIds ?? [];

  const usedSubs = new Set<number>()
  const subsOut = new Set<number>();
  let total = 0;

  const finalXI: number[] = [];
  const finalBench: number[] = [...bench];

  const counts = emptyCounts();

  const getEv = (id: number) => eventsById[String(id)];
  const getPos = (id: number) => playersById.get(id)?.position ?? null;

  // Identify starter GK (should be exactly one in valid teams)
  const starterGK = starters.find((id) => getPos(id) === "GK") ?? null;

  // Bench GK is the GK in bench (if any)
  const benchGK = bench.find((id) => getPos(id) === "GK") ?? null;

  // --- 1) Handle GK slot ---
  if (starterGK) {
    const ev = getEv(starterGK);
    if (played(ev)) {
      finalXI.push(starterGK);
      addCount(counts, "GK", 1);
      total += calcPoints("GK", ev);
    } else {
      // starter GK did not play -> try bench GK
      if (benchGK) {
        const bev = getEv(benchGK);
        if (played(bev)) {
          // sub in bench GK
          usedSubs.add(benchGK);
          subsOut.add(starterGK);

          finalXI.push(benchGK);
          addCount(counts, "GK", 1);
          total += calcPoints("GK", bev);

          // move starter GK "to bench" (conceptually) -> put them into the GK bench slot
          // and remove benchGK from bench
          for (let i = 0; i < finalBench.length; i++) {
            if (finalBench[i] === benchGK) finalBench[i] = starterGK;
          }
        } else {
          // no GK played -> no GK points
        }
      }
    }
  }

  // --- 2) Process outfield starters: keep those who played, track DNP by position ---
  const dnpOutfield: Record<"DEF" | "MID" | "FWD", number[]> = { DEF: [], MID: [], FWD: [] };

  for (const sid of starters) {
    const pos = getPos(sid);
    if (!pos || pos === "GK") continue;

    const ev = getEv(sid);
    if (played(ev)) {
      finalXI.push(sid);
      addCount(counts, pos, 1);
      total += calcPoints(pos, ev);
    } else {
      dnpOutfield[pos].push(sid);
    }
  }

  // --- 3) Sub in bench outfield in bench order, respecting formation max and min reachability ---
  const benchOutfield = bench.filter((id) => getPos(id) !== "GK");

  for (const bid of benchOutfield) {
    if (usedSubs.has(bid)) continue;

    const pos = getPos(bid);
    if (!pos || pos === "GK") continue;

    const ev = getEv(bid);
    if (!played(ev)) continue;

    const missingNow = dnpOutfield.DEF.length + dnpOutfield.MID.length + dnpOutfield.FWD.length;
    if (missingNow <= 0) break;

    // try add this bench player to XI
    const next: Counts = { ...counts };
    addCount(next, pos, 1);

    // must not violate max limits
    if (!withinMax(next)) continue;

    // must still be possible to reach minimums with remaining subs
    const remainingSlots = missingNow - 1;
    if (!canReachMins(next, remainingSlots)) continue;

    // choose which DNP starter slot gets replaced:
    // prefer same position; otherwise fallback order
    const order =
      pos === "DEF"
        ? (["DEF", "MID", "FWD"] as const)
        : pos === "MID"
          ? (["MID", "DEF", "FWD"] as const)
          : (["FWD", "MID", "DEF"] as const);

    let replacedPos: "DEF" | "MID" | "FWD" | null = null;
    for (const p of order) {
      if (dnpOutfield[p].length > 0) {
        replacedPos = p;
        break;
      }
    }
    if (!replacedPos) continue;

    const outId = dnpOutfield[replacedPos].shift()!;
    subsOut.add(outId);

    // Commit the sub:
    usedSubs.add(bid);
    finalXI.push(bid);

    counts.DEF = next.DEF;
    counts.MID = next.MID;
    counts.FWD = next.FWD;

    total += calcPoints(pos, ev);

    // Conceptual "move outId to bench" and remove bid from bench:
    // replace the bench slot containing bid with outId
    for (let i = 0; i < finalBench.length; i++) {
      if (finalBench[i] === bid) {
        finalBench[i] = outId;
        break;
      }
    }
  }

  // final XI should be <= 11 depending on whether user saved correctly.
  // If you want strict behavior: only count first 11 (and ignore extras). But ideally it’s always 11.
  const finalStartingXIIds = finalXI.slice(0, 11);
  const finalBenchIds = finalBench;

  return {
    total,
    subsUsed: Array.from(usedSubs),
    subsOut: Array.from(subsOut),
    finalStartingXIIds,
    finalBenchIds,
    counts,
  };
}
