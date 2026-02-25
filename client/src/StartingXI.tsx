import React, { useEffect, useMemo, useRef, useState } from "react";
import type { FC } from "react";

export type Position = "GK" | "DEF" | "MID" | "FWD";

export type Player = {
  id: number;
  name: string;
  position: Position;
  teamId: number;
  value: number;
};

export type Team = { id: number; name: string };

export type FormationKey = "3-5-2" | "3-4-3" | "4-4-2" | "4-3-3" | "4-5-1" | "5-3-2" | "5-4-1";

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

function teamName(teams: Team[], teamId: number) {
  return teams.find((t) => t.id === teamId)?.name ?? "";
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

type SwapSource = { area: "xi" | "bench"; slotId: string } | null;

export type StartingXISavePayload = {
  formation: FormationKey;
  startingXI: Player[];
  bench: Player[];
};

export const StartingXI: FC<{
  teams: Team[];
  squad: Player[]; // MUST be 15
  initialXI: Player[]; // 11
  initialBench: Player[]; // 4 (ordered)
  initialFormation: FormationKey;
  budget: number;
  readOnly?: boolean;
  onSave: (payload: StartingXISavePayload) => void | Promise<void>;
}> = ({ teams, squad, initialXI, initialBench, initialFormation, budget, readOnly = false, onSave }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [formation, setFormation] = useState<FormationKey>(initialFormation);
  const [slots, setSlots] = useState<Slot[]>(() => buildSlots(initialFormation));
  const [xiAssign, setXiAssign] = useState<Record<string, Player | null>>({});
  const [benchAssign, setBenchAssign] = useState<Record<string, Player | null>>({});
  const [swapSource, setSwapSource] = useState<SwapSource>(null);

  // close popups on outside click
  useEffect(() => {
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setSwapSource(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, []);

  const pool = useMemo(() => uniqById(squad), [squad]);
  const poolSet = useMemo(() => new Set(pool.map((p) => p.id)), [pool]);

  // init / sync
  useEffect(() => {
    setFormation(initialFormation);
    const s = buildSlots(initialFormation);
    setSlots(s);

    const xiMap: Record<string, Player | null> = {};
    s.forEach((sl) => (xiMap[sl.id] = null));

    // fill XI by position in slot order
    const xiRem = initialXI.filter((p) => poolSet.has(p.id));
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

    // bench order EXACT (and filtered to pool)
    const b = initialBench.filter((p) => poolSet.has(p.id));
    bMap["bench-gk"] = b[0] ?? null;
    bMap["bench-1"] = b[1] ?? null;
    bMap["bench-2"] = b[2] ?? null;
    bMap["bench-3"] = b[3] ?? null;

    // If missing players (because old data), rebuild from pool deterministically:
    const used = new Set<number>();
    for (const v of Object.values(xiMap)) if (v) used.add(v.id);
    for (const v of Object.values(bMap)) if (v) used.add(v.id);

    const leftovers = pool.filter((p) => !used.has(p.id));

    // ensure XI has 11 by filling matching positions
    for (const sl of s) {
      if (xiMap[sl.id]) continue;
      const idx = leftovers.findIndex((p) => p.position === sl.position);
      if (idx >= 0) xiMap[sl.id] = leftovers.splice(idx, 1)[0];
    }

    // ensure bench has 4 with correct kinds
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
  }, [poolSet, initialFormation, initialXI, initialBench, squad]);

  const xiPlayers = useMemo(() => Object.values(xiAssign).filter(Boolean) as Player[], [xiAssign]);
  const benchPlayers = useMemo(() => (Object.values(benchAssign).filter(Boolean) as Player[]), [benchAssign]);
  const pickedIds = useMemo(() => new Set([...xiPlayers, ...benchPlayers].map((p) => p.id)), [xiPlayers, benchPlayers]);

  const totalValue = useMemo(() => [...xiPlayers, ...benchPlayers].reduce((s, p) => s + p.value, 0), [xiPlayers, benchPlayers]);
  const remainingBudget = budget - totalValue;

  // validation
  const f = FORMATIONS[formation];
  const xiCounts = useMemo(() => {
    const c: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of xiPlayers) c[p.position] += 1;
    return c;
  }, [xiPlayers]);

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

    // must be subset of squad
    for (const p of [...xiPlayers, ...benchPlayers]) if (!poolSet.has(p.id)) return false;
    // no duplicates
    if (pickedIds.size !== 15) return false;

    return remainingBudget >= 0;
  }

  // swap helpers
  function beginSwap(area: "xi" | "bench", slotId: string) {
    if (readOnly) return;
    const p = area === "xi" ? xiAssign[slotId] : benchAssign[slotId];
    if (!p) return;
    setSwapSource({ area, slotId });
  }

  function trySwap(targetArea: "xi" | "bench", targetSlotId: string) {
    if (readOnly) return;
    if (!swapSource) return;
    if (swapSource.area === targetArea) return;

    const srcP = swapSource.area === "xi" ? xiAssign[swapSource.slotId] : benchAssign[swapSource.slotId];
    const dstP = targetArea === "xi" ? xiAssign[targetSlotId] : benchAssign[targetSlotId];
    if (!srcP || !dstP) return;

    const xiSlotId = targetArea === "xi" ? targetSlotId : swapSource.slotId;
    const benchSlotId = targetArea === "bench" ? targetSlotId : swapSource.slotId;

    const xiSlot = slots.find((s) => s.id === xiSlotId);
    const benchSlot = BENCH_SLOTS.find((b) => b.id === benchSlotId);
    if (!xiSlot || !benchSlot) return;

    const incomingToXI = targetArea === "xi" ? srcP : dstP;
    const incomingToBench = targetArea === "bench" ? srcP : dstP;

    if (incomingToXI.position !== xiSlot.position) return;
    if (benchSlot.kind === "GK" && incomingToBench.position !== "GK") return;
    if (benchSlot.kind === "FIELD" && incomingToBench.position === "GK") return;

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
    if (readOnly) return;

    const nextSlots = buildSlots(next);
    const req = FORMATIONS[next];

    // stable pool order: current XI then bench then rest
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

  const saveDisabled = !isValid();

  const Row = ({ position }: { position: Position }) => {
    const rowSlots = slots.filter((s) => s.position === position);

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length}`}>
        {rowSlots.map((s) => {
          const assigned = xiAssign[s.id];
          const canSwap = !readOnly;

          return (
            <div
              key={s.id}
              className={`slot ${assigned ? "slot-filled" : ""}`}
              onClick={() => {
                if (readOnly) return;
                if (swapSource && swapSource.area === "bench" && assigned) {
                  trySwap("xi", s.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              {assigned ? (
                <div className="player-chip">
                  <div className="player-name">{assigned.name}</div>
                  <div className="player-team">{teamName(teams, assigned.teamId)}</div>

                  {canSwap && (
                    <button
                      type="button"
                      className="swap-slot"
                      title="Vaihda penkille / kentälle"
                      onClick={(e) => {
                        e.stopPropagation();
                        beginSwap("xi", s.id);
                      }}
                    >
                      ⇄
                    </button>
                  )}
                </div>
              ) : (
                <div className="slot-empty">{s.label}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const Bench = () => {
    return (
      <div className="bench">
        <h3 className="app-h2" style={{ marginTop: 16 }}>
          Penkki
        </h3>

        <div className="bench-row">
          {BENCH_SLOTS.map((s) => {
            const assigned = benchAssign[s.id] ?? null;
            const canSwap = !readOnly;

            return (
              <div
                key={s.id}
                className={`slot ${assigned ? "slot-filled" : ""}`}
                onClick={() => {
                  if (readOnly) return;
                  if (swapSource && swapSource.area === "xi" && assigned) {
                    trySwap("bench", s.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                {assigned ? (
                  <div className="player-chip">
                    <div className="player-name">{assigned.name}</div>
                    <div className="player-team">{teamName(teams, assigned.teamId)}</div>

                    {canSwap && (
                      <button
                        type="button"
                        className="swap-slot"
                        title="Vaihda penkille / kentälle"
                        onClick={(e) => {
                          e.stopPropagation();
                          beginSwap("bench", s.id);
                        }}
                      >
                        ⇄
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="slot-empty">{s.label}</div>
                )}
              </div>
            );
          })}
        </div>

        {swapSource && (
          <div className="starting-xi-warning" role="alert" style={{ marginTop: 8, opacity: 0.9 }}>
            Vaihto valittu — klikkaa vastapuolen pelaajaa.
            <button
              type="button"
              className="app-btn"
              style={{ marginLeft: 8, padding: "2px 8px" }}
              onClick={() => setSwapSource(null)}
            >
              Peru
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="starting-xi-root" ref={rootRef}>
      <div className="starting-xi-card">
        <header className="starting-xi-header">
          <h2>Avauskokoonpano</h2>

          <div className="app-muted" style={{ marginBottom: 8 }}>
            Budjetti jäljellä: <b>{remainingBudget.toFixed(1)} M</b>
          </div>

          <div className="starting-xi-meta">
            <div className="meta-pill meta-formation">
              <span>
                Formaatio: <b>{formation}</b>
              </span>

              <select
                className="formation-select"
                value={formation}
                onChange={(e) => applyFormation(e.target.value as FormationKey)}
                disabled={readOnly}
              >
                {(Object.keys(FORMATIONS) as FormationKey[]).map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {!isValid() && (
            <div className="starting-xi-warning" role="alert">
              Avaus / penkki ei ole kelvollinen.
            </div>
          )}
        </header>

        <div className="pitch">
          <Row position="GK" />
          <Row position="DEF" />
          <Row position="MID" />
          <Row position="FWD" />
        </div>

        <Bench />

        <div className="starting-xi-controls">
          {!readOnly && (
            <button
              type="button"
              className="xi-save"
              onClick={() => onSave({ formation, startingXI: xiPlayers, bench: benchPlayers })}
              disabled={saveDisabled}
            >
              Tallenna
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StartingXI;