export type Position = "GK" | "DEF" | "MID" | "FWD";

export type PlayerLite = { id: number; position: Position };

export type StarPlayers = {
  DEF?: number | null;
  MID?: number | null;
  FWD?: number | null;
};

export type TeamData = {
  startingXIIds: number[];
  benchIds: number[];
  starPlayerIds?: StarPlayers;
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

  if (ev.minutes === "1_59") pts += 1;
  if (ev.minutes === "60+") pts += 2;

  if (ev.goals > 0) {
    if (pos === "GK") pts += ev.goals * 10;
    else if (pos === "DEF") pts += ev.goals * 6;
    else if (pos === "MID") pts += ev.goals * 5;
    else pts += ev.goals * 4;
  }

  pts += ev.assists * 3;

  if (ev.cleanSheet) {
    if (pos === "GK" || pos === "DEF") pts += 4;
    else if (pos === "MID") pts += 1;
  }

  pts += ev.penSaved * (pos === "GK" ? 3 : 0);
  pts += ev.penMissed * -2;

  pts += ev.yellow * -1;
  pts += ev.red * -3;
  pts += ev.ownGoals * -2;

  return pts;
}

function applyStarMultiplier(
  basePoints: number,
  playerId: number,
  finalPos: Position,
  stars: StarPlayers
): number {
  const starId =
    finalPos === "DEF"
      ? stars.DEF
      : finalPos === "MID"
        ? stars.MID
        : finalPos === "FWD"
          ? stars.FWD
          : null;

  if (Number(starId) !== playerId) return basePoints;
  return Math.round(basePoints * 1.5);
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
  const starPlayerIds = team.starPlayerIds ?? {};
  const starters = team.startingXIIds ?? [];
  const bench = team.benchIds ?? [];

  const usedSubs = new Set<number>();
  const subsOut = new Set<number>();
  let total = 0;

  // Keep original XI intact
  const finalStartingXIIds: number[] = [...starters];
  const finalBench: number[] = [...bench];

  const counts = emptyCounts();

  const getEv = (id: number) => eventsById[String(id)];
  const getPos = (id: number) => playersById.get(id)?.position ?? null;

  const swapBenchPlayer = (benchId: number, outId: number) => {
    for (let i = 0; i < finalBench.length; i++) {
      if (finalBench[i] === benchId) {
        finalBench[i] = outId;
        break;
      }
    }
  };

  const starterGK = starters.find((id) => getPos(id) === "GK") ?? null;
  const benchGK = bench.find((id) => getPos(id) === "GK") ?? null;

  if (starterGK) {
    const ev = getEv(starterGK);

    if (played(ev)) {
      addCount(counts, "GK", 1);
      total += calcPoints("GK", ev);
    } else if (benchGK) {
      const bev = getEv(benchGK);
      const benchPoints = played(bev) ? calcPoints("GK", bev) : 0;

      if (played(bev) && benchPoints > 0) {
        usedSubs.add(benchGK);
        subsOut.add(starterGK);

        addCount(counts, "GK", 1);
        total += benchPoints;

        swapBenchPlayer(benchGK, starterGK);
      }
    }
  }

  const dnpOutfield: Record<"DEF" | "MID" | "FWD", number[]> = {
    DEF: [],
    MID: [],
    FWD: [],
  };

  for (const sid of starters) {
    const pos = getPos(sid);
    if (!pos || pos === "GK") continue;

    const ev = getEv(sid);
    if (played(ev)) {
      addCount(counts, pos, 1);

      const base = calcPoints(pos, ev);
      total += applyStarMultiplier(base, sid, pos, starPlayerIds);
    } else {
      dnpOutfield[pos].push(sid);
    }
  }

  const benchOutfield = bench.filter((id) => getPos(id) !== "GK");

  for (const bid of benchOutfield) {
    if (usedSubs.has(bid)) continue;

    const pos = getPos(bid);
    if (!pos || pos === "GK") continue;

    const ev = getEv(bid);
    if (!played(ev)) continue;

    const base = calcPoints(pos, ev);
    if (base <= 0) continue;

    const missingNow =
      dnpOutfield.DEF.length + dnpOutfield.MID.length + dnpOutfield.FWD.length;

    if (missingNow <= 0) break;

    const next: Counts = { ...counts };
    addCount(next, pos, 1);

    if (!withinMax(next)) continue;

    const remainingSlots = missingNow - 1;
    if (!canReachMins(next, remainingSlots)) continue;

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
    usedSubs.add(bid);

    counts.DEF = next.DEF;
    counts.MID = next.MID;
    counts.FWD = next.FWD;

    total += base;

    swapBenchPlayer(bid, outId);
  }

  return {
    total,
    subsUsed: Array.from(usedSubs),
    subsOut: Array.from(subsOut),
    finalStartingXIIds,
    finalBenchIds: finalBench,
    counts,
  };
}

export function scoreTeamForRoundWithAutosubFromPoints(args: {
  team: TeamData;
  playersById: Map<number, PlayerLite>;
  eventsById: Record<string, PlayerEventInput>;
  pointsById: Record<string, number>;
}) {
  const { team, playersById, eventsById, pointsById } = args;
  const starPlayerIds = team.starPlayerIds ?? {};
  const starters = team.startingXIIds ?? [];
  const bench = team.benchIds ?? [];

  const usedSubs = new Set<number>();
  const subsOut = new Set<number>();
  let total = 0;

  const finalXI: number[] = [];
  const finalBench: number[] = [...bench];

  const counts = emptyCounts();

  const getEv = (id: number) => eventsById[String(id)];
  const getPos = (id: number) => playersById.get(id)?.position ?? null;
  const getPts = (id: number) => Number(pointsById[String(id)] ?? 0);

  const starterGK = starters.find((id) => getPos(id) === "GK") ?? null;
  const benchGK = bench.find((id) => getPos(id) === "GK") ?? null;

  if (starterGK) {
    const ev = getEv(starterGK);
    if (played(ev)) {
      finalXI.push(starterGK);
      addCount(counts, "GK", 1);
      total += getPts(starterGK);
    } else if (benchGK) {
      const bev = getEv(benchGK);
      if (played(bev)) {
        usedSubs.add(benchGK);
        subsOut.add(starterGK);

        finalXI.push(benchGK);
        addCount(counts, "GK", 1);
        total += getPts(benchGK);

        for (let i = 0; i < finalBench.length; i++) {
          if (finalBench[i] === benchGK) finalBench[i] = starterGK;
        }
      }
    }
  }

  const dnpOutfield: Record<"DEF" | "MID" | "FWD", number[]> = { DEF: [], MID: [], FWD: [] };

  for (const sid of starters) {
    const pos = getPos(sid);
    if (!pos || pos === "GK") continue;

    const ev = getEv(sid);
    if (played(ev)) {
      finalXI.push(sid);
      addCount(counts, pos, 1);

      const base = getPts(sid);
      total += applyStarMultiplier(base, sid, pos, starPlayerIds);
    } else {
      dnpOutfield[pos].push(sid);
    }
  }

  const benchOutfield = bench.filter((id) => getPos(id) !== "GK");

  for (const bid of benchOutfield) {
    if (usedSubs.has(bid)) continue;

    const pos = getPos(bid);
    if (!pos || pos === "GK") continue;

    const ev = getEv(bid);
    if (!played(ev)) continue;

    const missingNow = dnpOutfield.DEF.length + dnpOutfield.MID.length + dnpOutfield.FWD.length;
    if (missingNow <= 0) break;

    const next: Counts = { ...counts };
    addCount(next, pos, 1);

    if (!withinMax(next)) continue;

    const remainingSlots = missingNow - 1;
    if (!canReachMins(next, remainingSlots)) continue;

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

    usedSubs.add(bid);
    finalXI.push(bid);

    counts.DEF = next.DEF;
    counts.MID = next.MID;
    counts.FWD = next.FWD;

    total += getPts(bid);

    for (let i = 0; i < finalBench.length; i++) {
      if (finalBench[i] === bid) {
        finalBench[i] = outId;
        break;
      }
    }
  }

  return {
    total,
    subsUsed: Array.from(usedSubs),
    subsOut: Array.from(subsOut),
    finalStartingXIIds: finalXI.slice(0, 11),
    finalBenchIds: finalBench,
    counts,
  };
}