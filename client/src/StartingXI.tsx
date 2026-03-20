import React, { useEffect, useMemo, useRef, useState } from "react";
import type { FC } from "react";

export type Position = "GK" | "DEF" | "MID" | "FWD";

export type Player = {
  id: number;
  name: string;
  position: Position;
  teamId: number;
  value: number;
  lastGwPoints?: number;
};

export type Team = { id: number; name: string };

export type FormationKey =
  | "3-5-2"
  | "3-4-3"
  | "4-4-2"
  | "4-3-3"
  | "4-5-1"
  | "5-3-2"
  | "5-4-1";

export const FORMATIONS: Record<FormationKey, { DEF: number; MID: number; FWD: number }> = {
  "3-5-2": { DEF: 3, MID: 5, FWD: 2 },
  "3-4-3": { DEF: 3, MID: 4, FWD: 3 },
  "4-4-2": { DEF: 4, MID: 4, FWD: 2 },
  "4-3-3": { DEF: 4, MID: 3, FWD: 3 },
  "4-5-1": { DEF: 4, MID: 5, FWD: 1 },
  "5-3-2": { DEF: 5, MID: 3, FWD: 2 },
  "5-4-1": { DEF: 5, MID: 4, FWD: 1 },
};

type Slot = { id: string; position: Position; label: string };
type BenchSlot = { id: string; label: string; kind: "GK" | "FIELD" };

const BENCH_SLOTS: BenchSlot[] = [
  { id: "bench-gk", label: "MV", kind: "GK" },
  { id: "bench-1", label: "PENKKI", kind: "FIELD" },
  { id: "bench-2", label: "PENKKI", kind: "FIELD" },
  { id: "bench-3", label: "PENKKI", kind: "FIELD" },
];

function buildSlots(formation: FormationKey): Slot[] {
  const f = FORMATIONS[formation];
  const slots: Slot[] = [{ id: "gk-1", position: "GK", label: "MV" }];
  for (let i = 1; i <= f.DEF; i++) slots.push({ id: `def-${i}`, position: "DEF", label: "P" });
  for (let i = 1; i <= f.MID; i++) slots.push({ id: `mid-${i}`, position: "MID", label: "KK" });
  for (let i = 1; i <= f.FWD; i++) slots.push({ id: `fwd-${i}`, position: "FWD", label: "H" });
  return slots;
}

function inferFormationFromXI(xi: Player[]): FormationKey | null {
  const def = xi.filter((p) => p.position === "DEF").length;
  const mid = xi.filter((p) => p.position === "MID").length;
  const fwd = xi.filter((p) => p.position === "FWD").length;

  const key = `${def}-${mid}-${fwd}` as const;

  switch (key) {
    case "3-5-2":
    case "3-4-3":
    case "4-4-2":
    case "4-3-3":
    case "4-5-1":
    case "5-3-2":
    case "5-4-1":
      return key;
    default:
      return null;
  }
}

function teamName(teams: Team[], teamId: number) {
  return teams.find((t) => t.id === teamId)?.name ?? "";
}

function lastName(full: string) {
  const s = (full ?? "").trim();
  if (!s) return "";
  const parts = s.split(/\s+/);
  return parts[parts.length - 1];
}

function uniqById(list: Player[]) {
  const seen = new Set<number>();
  const out: Player[] = [];
  for (const p of list) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

function groupByPos(list: Player[]) {
  const by: Record<Position, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of list) by[p.position].push(p);
  return by;
}

function applyLastGwPoints(players: Player[], pointsById?: Record<number, number>): Player[] {
  if (!pointsById) return players;
  return players.map((p) => ({
    ...p,
    lastGwPoints: pointsById[p.id] ?? p.lastGwPoints ?? 0,
  }));
}

function isStarPlayer(
  player: Player,
  starIds: { DEF?: number | null; MID?: number | null; FWD?: number | null }
) {
  return (
    (player.position === "DEF" && Number(starIds.DEF) === player.id) ||
    (player.position === "MID" && Number(starIds.MID) === player.id) ||
    (player.position === "FWD" && Number(starIds.FWD) === player.id)
  );
}

function getDisplayedPlayerPoints(
  player: Player,
  starIds: { DEF?: number | null; MID?: number | null; FWD?: number | null }
) {
  const base = player.lastGwPoints ?? 0;
  return isStarPlayer(player, starIds) ? Math.round(base * 1.5) : base;
}


type SwapSource = { area: "xi" | "bench"; slotId: string } | null;

export type StartingXISavePayload = {
  formation: FormationKey;
  startingXI: Player[];
  bench: Player[];
  starPlayerIds: {
    DEF: number | null;
    MID: number | null;
    FWD: number | null;
  };
};

export const StartingXI: FC<{
  teams: Team[];
  squad: Player[];

  initialXI: Player[];
  initialBench: Player[];

  scoredXI?: Player[];
  scoredBench?: Player[];
  enableScoredToggle?: boolean;
  scoredTotalPoints?: number; 
  initialFormation: FormationKey;
  initialStarPlayerIds?: {
    DEF?: number | null;
    MID?: number | null;
    FWD?: number | null;
  };
  lastGwPointsByPlayerId?: Record<number, number>;
  budget: number;
  readOnly?: boolean;
  onSave: (payload: StartingXISavePayload) => void | Promise<void>;
}> = ({
  teams,
  squad,
  initialXI,
  initialBench,
  initialFormation,
  initialStarPlayerIds,
  lastGwPointsByPlayerId,
  scoredTotalPoints,
  budget,
  scoredXI = [],
  scoredBench = [],
  enableScoredToggle = false,
  readOnly = false,
  onSave,
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [formation, setFormation] = useState<FormationKey>(initialFormation);
  const [slots, setSlots] = useState<Slot[]>(() => buildSlots(initialFormation));
  const [xiAssign, setXiAssign] = useState<Record<string, Player | null>>({});
  const [benchAssign, setBenchAssign] = useState<Record<string, Player | null>>({});
  const [swapSource, setSwapSource] = useState<SwapSource>(null);
  const [saveFlash, setSaveFlash] = useState<"idle" | "clicked" | "saved">("idle");
  const [starDEF, setStarDEF] = useState<number | "">(initialStarPlayerIds?.DEF ?? "");
  const [starMID, setStarMID] = useState<number | "">(initialStarPlayerIds?.MID ?? "");
  const [starFWD, setStarFWD] = useState<number | "">(initialStarPlayerIds?.FWD ?? "");
  const [viewMode, setViewMode] = useState<"original" | "scored">("original");
  

  const isScoredView = viewMode === "scored";

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setSwapSource(null);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  const currentStarIds = useMemo(
    () => ({
      DEF: starDEF === "" ? null : Number(starDEF),
      MID: starMID === "" ? null : Number(starMID),
      FWD: starFWD === "" ? null : Number(starFWD),
    }),
    [starDEF, starMID, starFWD]
  );

  const displayedXIInput = useMemo(
    () => (viewMode === "scored" && scoredXI.length ? scoredXI : initialXI),
    [viewMode, scoredXI, initialXI]
  );

  const displayedBenchInput = useMemo(
    () => (viewMode === "scored" && scoredBench.length ? scoredBench : initialBench),
    [viewMode, scoredBench, initialBench]
  );

  const displayedFormation = useMemo(() => {
    if (viewMode === "scored" && scoredXI.length) {
      return inferFormationFromXI(scoredXI) ?? initialFormation;
    }
    return initialFormation;
  }, [viewMode, scoredXI, initialFormation]);

  const squadWithPoints = useMemo(
    () => applyLastGwPoints(squad, lastGwPointsByPlayerId),
    [squad, lastGwPointsByPlayerId]
  );

  const initialXIWithPoints = useMemo(
    () => applyLastGwPoints(displayedXIInput, lastGwPointsByPlayerId),
    [displayedXIInput, lastGwPointsByPlayerId]
  );

  const initialBenchWithPoints = useMemo(
    () => applyLastGwPoints(displayedBenchInput, lastGwPointsByPlayerId),
    [displayedBenchInput, lastGwPointsByPlayerId]
  );

  const pool = useMemo(() => uniqById(squadWithPoints), [squadWithPoints]);
  const poolSet = useMemo(() => new Set(pool.map((p) => p.id)), [pool]);

  useEffect(() => {
    setFormation(displayedFormation);

    const s = buildSlots(displayedFormation);
    setSlots(s);

    const xiMap: Record<string, Player | null> = {};
    s.forEach((sl) => (xiMap[sl.id] = null));

    const xiRem = initialXIWithPoints.filter((p) => poolSet.has(p.id));
    const rem = [...xiRem];
    for (const sl of s) {
      const idx = rem.findIndex((p) => p.position === sl.position);
      if (idx >= 0) {
        xiMap[sl.id] = rem[idx];
        rem.splice(idx, 1);
      }
    }

    const bMap: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((b) => (bMap[b.id] = null));

    const b = initialBenchWithPoints.filter((p) => poolSet.has(p.id));
    bMap["bench-gk"] = b[0] ?? null;
    bMap["bench-1"] = b[1] ?? null;
    bMap["bench-2"] = b[2] ?? null;
    bMap["bench-3"] = b[3] ?? null;

    const used = new Set<number>();
    for (const v of Object.values(xiMap)) if (v) used.add(v.id);
    for (const v of Object.values(bMap)) if (v) used.add(v.id);

    const leftovers = pool.filter((p) => !used.has(p.id));

    for (const sl of s) {
      if (xiMap[sl.id]) continue;
      const idx = leftovers.findIndex((p) => p.position === sl.position);
      if (idx >= 0) xiMap[sl.id] = leftovers.splice(idx, 1)[0];
    }

    if (!bMap["bench-gk"]) {
      const idx = leftovers.findIndex((p) => p.position === "GK");
      if (idx >= 0) bMap["bench-gk"] = leftovers.splice(idx, 1)[0];
    }

    for (const bid of ["bench-1", "bench-2", "bench-3"] as const) {
      if (bMap[bid]) continue;
      const idx = leftovers.findIndex((p) => p.position !== "GK");
      if (idx >= 0) bMap[bid] = leftovers.splice(idx, 1)[0];
    }

    setXiAssign(xiMap);
    setBenchAssign(bMap);
    setSwapSource(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolSet, displayedFormation, initialXIWithPoints, initialBenchWithPoints, squadWithPoints]);

  const xiPlayers = useMemo(() => Object.values(xiAssign).filter(Boolean) as Player[], [xiAssign]);
  const benchPlayers = useMemo(() => Object.values(benchAssign).filter(Boolean) as Player[], [benchAssign]);

  const hasStartedPoints = useMemo(() => {
    const selectedPlayers = [...xiPlayers, ...benchPlayers];
    return selectedPlayers.some((p) => Number(p.lastGwPoints ?? 0) !== 0);
  }, [xiPlayers, benchPlayers]);

  const pickedIds = useMemo(
    () => new Set([...xiPlayers, ...benchPlayers].map((p) => p.id)),
    [xiPlayers, benchPlayers]
  );

  const totalValue = useMemo(
    () => [...xiPlayers, ...benchPlayers].reduce((s, p) => s + p.value, 0),
    [xiPlayers, benchPlayers]
  );

  const remainingBudget = budget - totalValue;
  const f = FORMATIONS[formation];

  const xiCounts = useMemo(() => {
    const c: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of xiPlayers) c[p.position] += 1;
    return c;
  }, [xiPlayers]);

  const xiDefs = useMemo(() => xiPlayers.filter((p) => p.position === "DEF"), [xiPlayers]);
  const xiMids = useMemo(() => xiPlayers.filter((p) => p.position === "MID"), [xiPlayers]);
  const xiFwds = useMemo(() => xiPlayers.filter((p) => p.position === "FWD"), [xiPlayers]);

  useEffect(() => {
    if (starDEF !== "" && !xiDefs.some((p) => p.id === starDEF)) setStarDEF("");
    if (starMID !== "" && !xiMids.some((p) => p.id === starMID)) setStarMID("");
    if (starFWD !== "" && !xiFwds.some((p) => p.id === starFWD)) setStarFWD("");
  }, [xiDefs, xiMids, xiFwds, starDEF, starMID, starFWD]);

  function isValid() {
    if (pool.length !== 15) return false;
    if (xiPlayers.length !== 11) return false;
    if (benchPlayers.length !== 4) return false;

    if (xiCounts.GK !== 1) return false;
    if (xiCounts.DEF !== f.DEF) return false;
    if (xiCounts.MID !== f.MID) return false;
    if (xiCounts.FWD !== f.FWD) return false;

    const gk = benchAssign["bench-gk"];
    if (!gk || gk.position !== "GK") return false;

    for (const id of ["bench-1", "bench-2", "bench-3"] as const) {
      const p = benchAssign[id];
      if (!p || p.position === "GK") return false;
    }

    for (const p of [...xiPlayers, ...benchPlayers]) {
      if (!poolSet.has(p.id)) return false;
    }

    if (pickedIds.size !== 15) return false;

    return remainingBudget >= 0;
  }

  function beginSwap(area: "xi" | "bench", slotId: string) {
    if (readOnly || hasStartedPoints || isScoredView) return;
    const p = area === "xi" ? xiAssign[slotId] : benchAssign[slotId];
    if (!p) return;
    setSwapSource({ area, slotId });
  }

  function benchAccepts(slot: BenchSlot, p: Player) {
    if (slot.kind === "GK") return p.position === "GK";
    return p.position !== "GK";
  }

  function isValidSwapTarget(targetArea: "xi" | "bench", targetSlotId: string) {
    if (!swapSource) return false;
    if (swapSource.area === targetArea && swapSource.slotId === targetSlotId) return false;

    const srcP = swapSource.area === "xi" ? xiAssign[swapSource.slotId] : benchAssign[swapSource.slotId];
    const dstP = targetArea === "xi" ? xiAssign[targetSlotId] : benchAssign[targetSlotId];
    if (!srcP || !dstP) return false;

    const srcXiSlot = swapSource.area === "xi" ? slots.find((s) => s.id === swapSource.slotId) : null;
    const dstXiSlot = targetArea === "xi" ? slots.find((s) => s.id === targetSlotId) : null;

    const srcBenchSlot = swapSource.area === "bench" ? BENCH_SLOTS.find((b) => b.id === swapSource.slotId) : null;
    const dstBenchSlot = targetArea === "bench" ? BENCH_SLOTS.find((b) => b.id === targetSlotId) : null;

    if (swapSource.area === "xi" && targetArea === "xi") {
      if (!srcXiSlot || !dstXiSlot) return false;
      return srcP.position === dstXiSlot.position && dstP.position === srcXiSlot.position;
    }

    if (swapSource.area === "bench" && targetArea === "bench") {
      if (!srcBenchSlot || !dstBenchSlot) return false;
      return benchAccepts(dstBenchSlot, srcP) && benchAccepts(srcBenchSlot, dstP);
    }

    const xiSlotId = targetArea === "xi" ? targetSlotId : swapSource.slotId;
    const benchSlotId = targetArea === "bench" ? targetSlotId : swapSource.slotId;

    const xiSlot = slots.find((s) => s.id === xiSlotId);
    const benchSlot = BENCH_SLOTS.find((b) => b.id === benchSlotId);
    if (!xiSlot || !benchSlot) return false;

    const incomingToXI = targetArea === "xi" ? srcP : dstP;
    const incomingToBench = targetArea === "bench" ? srcP : dstP;

    return incomingToXI.position === xiSlot.position && benchAccepts(benchSlot, incomingToBench);
  }

  function trySwap(targetArea: "xi" | "bench", targetSlotId: string) {
    if (readOnly || hasStartedPoints || isScoredView) return;
    if (!swapSource) return;

    if (swapSource.area === targetArea && swapSource.slotId === targetSlotId) return;

    const srcP = swapSource.area === "xi" ? xiAssign[swapSource.slotId] : benchAssign[swapSource.slotId];
    const dstP = targetArea === "xi" ? xiAssign[targetSlotId] : benchAssign[targetSlotId];
    if (!srcP || !dstP) return;

    const srcXiSlot = swapSource.area === "xi" ? slots.find((s) => s.id === swapSource.slotId) : null;
    const dstXiSlot = targetArea === "xi" ? slots.find((s) => s.id === targetSlotId) : null;

    const srcBenchSlot = swapSource.area === "bench" ? BENCH_SLOTS.find((b) => b.id === swapSource.slotId) : null;
    const dstBenchSlot = targetArea === "bench" ? BENCH_SLOTS.find((b) => b.id === targetSlotId) : null;

    if (swapSource.area === "xi" && targetArea === "xi") {
      if (!srcXiSlot || !dstXiSlot) return;
      if (srcP.position !== dstXiSlot.position) return;
      if (dstP.position !== srcXiSlot.position) return;

      setXiAssign((prev) => ({
        ...prev,
        [swapSource.slotId]: dstP,
        [targetSlotId]: srcP,
      }));
      setSwapSource(null);
      return;
    }

    if (swapSource.area === "bench" && targetArea === "bench") {
      if (!srcBenchSlot || !dstBenchSlot) return;
      if (!benchAccepts(dstBenchSlot, srcP)) return;
      if (!benchAccepts(srcBenchSlot, dstP)) return;

      setBenchAssign((prev) => ({
        ...prev,
        [swapSource.slotId]: dstP,
        [targetSlotId]: srcP,
      }));
      setSwapSource(null);
      return;
    }

    const xiSlotId = targetArea === "xi" ? targetSlotId : swapSource.slotId;
    const benchSlotId = targetArea === "bench" ? targetSlotId : swapSource.slotId;

    const xiSlot = slots.find((s) => s.id === xiSlotId);
    const benchSlot = BENCH_SLOTS.find((b) => b.id === benchSlotId);
    if (!xiSlot || !benchSlot) return;

    const incomingToXI = targetArea === "xi" ? srcP : dstP;
    const incomingToBench = targetArea === "bench" ? srcP : dstP;

    if (incomingToXI.position !== xiSlot.position) return;
    if (!benchAccepts(benchSlot, incomingToBench)) return;

    if (targetArea === "xi") {
      setXiAssign((prev) => ({ ...prev, [targetSlotId]: srcP }));
      setBenchAssign((prev) => ({ ...prev, [swapSource.slotId]: dstP }));
    } else {
      setBenchAssign((prev) => ({ ...prev, [targetSlotId]: srcP }));
      setXiAssign((prev) => ({ ...prev, [swapSource.slotId]: dstP }));
    }

    setSwapSource(null);
  }

  function applyFormation(next: FormationKey) {
    if (readOnly || hasStartedPoints || isScoredView) return;

    const nextSlots = buildSlots(next);
    const req = FORMATIONS[next];
    const currentOrder = uniqById([...xiPlayers, ...benchPlayers, ...pool]);
    const by = groupByPos(currentOrder);

    const xiMap: Record<string, Player | null> = {};
    nextSlots.forEach((sl) => (xiMap[sl.id] = null));
    xiMap["gk-1"] = by.GK.shift() ?? null;

    const fill = (pos: "DEF" | "MID" | "FWD", count: number) => {
      const row = nextSlots.filter((s) => s.position === pos);
      for (let i = 0; i < count; i++) xiMap[row[i].id] = by[pos].shift() ?? null;
    };

    fill("DEF", req.DEF);
    fill("MID", req.MID);
    fill("FWD", req.FWD);

    const bMap: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((b) => (bMap[b.id] = null));
    bMap["bench-gk"] = by.GK.shift() ?? null;

    const leftoverField = [...by.DEF, ...by.MID, ...by.FWD].filter(Boolean);
    bMap["bench-1"] = leftoverField[0] ?? null;
    bMap["bench-2"] = leftoverField[1] ?? null;
    bMap["bench-3"] = leftoverField[2] ?? null;

    setFormation(next);
    setSlots(nextSlots);
    setXiAssign(xiMap);
    setBenchAssign(bMap);
    setSwapSource(null);
  }

  useEffect(() => {
    setStarDEF(initialStarPlayerIds?.DEF ?? "");
    setStarMID(initialStarPlayerIds?.MID ?? "");
    setStarFWD(initialStarPlayerIds?.FWD ?? "");
  }, [initialStarPlayerIds]);

  const saveDisabled = !isValid() || hasStartedPoints || isScoredView;

  const PlayerSlot = ({
    area,
    slotId,
    assigned,
    emptyLabel,
    onSlotClick,
  }: {
    area: "xi" | "bench";
    slotId: string;
    assigned: Player | null | undefined;
    emptyLabel: string;
    onSlotClick: () => void;
  }) => {
    const isSource = !!swapSource && swapSource.area === area && swapSource.slotId === slotId;
    const oppositeAreaActive =
      !!swapSource &&
      ((swapSource.area === "xi" && area === "bench") || (swapSource.area === "bench" && area === "xi"));

    const isTarget = !!swapSource && isValidSwapTarget(area, slotId);
    const star = assigned ? isStarPlayer(assigned, currentStarIds) : false;
    const shownPoints = assigned ? getDisplayedPlayerPoints(assigned, currentStarIds) : 0;

    return (
      <div
        className={[
          "slot",
          assigned ? "slot-filled" : "",
          isSource ? "slot-swap-source" : "",
          oppositeAreaActive ? "slot-swap-hint" : "",
          isTarget ? "slot-swap-target" : "",
        ].join(" ")}
        onClick={onSlotClick}
        role="button"
        tabIndex={0}
      >
        {assigned ? (
          <div className="player-chip">
            <div className="player-name">
              {lastName(assigned.name)} {star ? <span className="player-star">★</span> : null}
            </div>
            <div className="player-team">{teamName(teams, assigned.teamId)}</div>
            {isScoredView && <div className="player-points">{shownPoints} p</div>}
          </div>
        ) : (
          <div className="slot-empty">{emptyLabel}</div>
        )}
      </div>
    );
  };

  const Row = ({ position }: { position: Position }) => {
    const rowSlots = slots.filter((s) => s.position === position);
    const highlightRow = !!swapSource && swapSource.area === "bench";

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length} ${highlightRow ? "pitch-row-swap-hint" : ""}`}>
        {rowSlots.map((s) => {
          const assigned = xiAssign[s.id] ?? null;

          return (
            <PlayerSlot
              key={s.id}
              area="xi"
              slotId={s.id}
              assigned={assigned}
              emptyLabel={s.label}
              onSlotClick={() => {
                if (readOnly || !assigned || isScoredView) return;

                if (!swapSource) {
                  beginSwap("xi", s.id);
                  return;
                }

                if (swapSource.area === "xi" && swapSource.slotId === s.id) {
                  setSwapSource(null);
                  return;
                }

                trySwap("xi", s.id);
              }}
            />
          );
        })}
      </div>
    );
  };

  const Bench = () => {
    const highlightBench = !!swapSource && swapSource.area === "xi";

    return (
      <div className={`bench ${highlightBench ? "bench-swap-hint" : ""}`}>
        <div className="bench-row">
          {BENCH_SLOTS.map((s) => {
            const assigned = benchAssign[s.id] ?? null;

            return (
              <div key={s.id} className="bench-item">
                {assigned && (
                  <div className={`bench-tag bench-tag-${assigned.position}`}>
                    {assigned.position === "FWD" ? "ST" : assigned.position}
                  </div>
                )}

                <PlayerSlot
                  area="bench"
                  slotId={s.id}
                  assigned={assigned}
                  emptyLabel={s.label}
                  onSlotClick={() => {
                    if (readOnly || !assigned || isScoredView) return;

                    if (!swapSource) {
                      beginSwap("bench", s.id);
                      return;
                    }

                    if (swapSource.area === "bench" && swapSource.slotId === s.id) {
                      setSwapSource(null);
                      return;
                    }

                    trySwap("bench", s.id);
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="starting-xi-root" ref={rootRef}>
      <div className="starting-xi-card">
        <header className="starting-xi-header">
          <h3>Avauskokoonpano</h3>

          <div className="starting-xi-meta">
            <div className="meta-pill meta-formation">
              <select
                className="formation-select"
                value={formation}
                onChange={(e) => applyFormation(e.target.value as FormationKey)}
                disabled={readOnly || hasStartedPoints || isScoredView}
              >
                {(Object.keys(FORMATIONS) as FormationKey[]).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {enableScoredToggle && (
            <div className="starting-xi-meta" style={{ marginTop: 8 }}>
              <div className="xi-action-group">
                <button
                  type="button"
                  className={`app-btn ${viewMode === "original" ? "app-btn-active" : ""}`}
                  onClick={() => setViewMode("original")}
                >
                  Alkuperäinen
                </button>

                <button
                  type="button"
                  className={`app-btn ${viewMode === "scored" ? "app-btn-active" : ""}`}
                  onClick={() => setViewMode("scored")}
                  disabled={!scoredXI.length && !scoredBench.length}
                >
                  Pisteytetty
                </button>
              </div>
            </div>
          )}

          {!isValid() && (
            <div className="starting-xi-warning" role="alert">
              Kokoonpano ei ole kelvollinen. Lisää pelaajia vaihdot kohdasta
            </div>
          )}
        </header>

        <div className="pitch">
          <Row position="GK" />
          <Row position="DEF" />
          <Row position="MID" />
          <Row position="FWD" />

          <div className="bench-overlay">
            <Bench />
          </div>
        </div>

        <div className="starting-star-controls">
          <div className="xi-action-group">
            {!readOnly && (
              <button
                type="button"
                className={`xi-save ${saveFlash !== "idle" ? `xi-save--${saveFlash}` : ""}`}
                onClick={() => {
                  if (saveDisabled || readOnly) return;

                  const missingStars = [
                    starDEF === "" ? "DEF" : null,
                    starMID === "" ? "MID" : null,
                    starFWD === "" ? "FWD" : null,
                  ].filter(Boolean) as string[];

                  if (missingStars.length > 0) {
                    const ok = window.confirm(
                      `Tähtipelaaja puuttuu: ${missingStars.join(", ")}.\n\nHaluatko tallentaa silti?`
                    );
                    if (!ok) return;
                  }

                  setSaveFlash("clicked");
                  window.setTimeout(() => setSaveFlash("saved"), 250);
                  window.setTimeout(() => setSaveFlash("idle"), 1400);

                  onSave({
                    formation,
                    startingXI: xiPlayers,
                    bench: benchPlayers,
                    starPlayerIds: {
                      DEF: starDEF === "" ? null : starDEF,
                      MID: starMID === "" ? null : starMID,
                      FWD: starFWD === "" ? null : starFWD,
                    },
                  });
                }}
                disabled={saveDisabled}
              >
                {saveFlash === "clicked"
                  ? "Tallennetaan…"
                  : saveFlash === "saved"
                    ? "Tallennettu ✓"
                    : "Tallenna"}
              </button>
            )}

            <button
              type="button"
              className={`xi-cancel-swap ${!readOnly && swapSource ? "" : "xi-cancel-swap--hidden"}`}
              onClick={() => setSwapSource(null)}
              disabled={!swapSource}
              aria-hidden={!swapSource}
            >
              Peru vaihto
            </button>
          </div>

          <div className="star-player-controls">
            <label className="star-pick">
              <span className="star-pick-label">P ★</span>
              <select
                className="star-pick-select"
                value={starDEF}
                onChange={(e) => setStarDEF(e.target.value ? Number(e.target.value) : "")}
                disabled={readOnly || hasStartedPoints || isScoredView || xiDefs.length === 0}
              >
                <option value="">Ei valittu</option>
                {xiDefs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {lastName(p.name)}
                  </option>
                ))}
              </select>
            </label>

            <label className="star-pick">
              <span className="star-pick-label">KK ★</span>
              <select
                className="star-pick-select"
                value={starMID}
                onChange={(e) => setStarMID(e.target.value ? Number(e.target.value) : "")}
                disabled={readOnly || hasStartedPoints || isScoredView || xiMids.length === 0}
              >
                <option value="">Ei valittu</option>
                {xiMids.map((p) => (
                  <option key={p.id} value={p.id}>
                    {lastName(p.name)}
                  </option>
                ))}
              </select>
            </label>

            <label className="star-pick">
              <span className="star-pick-label">H ★</span>
              <select
                className="star-pick-select"
                value={starFWD}
                onChange={(e) => setStarFWD(e.target.value ? Number(e.target.value) : "")}
                disabled={readOnly || hasStartedPoints || isScoredView || xiFwds.length === 0}
              >
                <option value="">Ei valittu</option>
                {xiFwds.map((p) => (
                  <option key={p.id} value={p.id}>
                    {lastName(p.name)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StartingXI;