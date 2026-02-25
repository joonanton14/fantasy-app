import React, { useEffect, useMemo, useRef, useState } from "react";
import type { FC } from "react";

export type Position = "GK" | "DEF" | "MID" | "FWD";

export interface Player {
  id: number;
  name: string;
  position: Position;
  teamId: number;
  value: number;
}

export interface Team {
  id: number;
  name: string;
}

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

function buildStandardSlots(formation: FormationKey): Slot[] {
  const f = FORMATIONS[formation];
  const slots: Slot[] = [{ id: "gk-1", position: "GK", label: "MV" }];
  for (let i = 1; i <= f.DEF; i++) slots.push({ id: `def-${i}`, position: "DEF", label: "P" });
  for (let i = 1; i <= f.MID; i++) slots.push({ id: `mid-${i}`, position: "MID", label: "KK" });
  for (let i = 1; i <= f.FWD; i++) slots.push({ id: `fwd-${i}`, position: "FWD", label: "H" });
  return slots;
}

// TransfersPage squad builder: 2 GK, 5 DEF, 5 MID, 3 FWD = 15
function buildSquad15Slots(): Slot[] {
  const slots: Slot[] = [];
  slots.push({ id: "sq-gk-1", position: "GK", label: "MV" });
  slots.push({ id: "sq-gk-2", position: "GK", label: "MV" });
  for (let i = 1; i <= 5; i++) slots.push({ id: `sq-def-${i}`, position: "DEF", label: "P" });
  for (let i = 1; i <= 5; i++) slots.push({ id: `sq-mid-${i}`, position: "MID", label: "KK" });
  for (let i = 1; i <= 3; i++) slots.push({ id: `sq-fwd-${i}`, position: "FWD", label: "H" });
  return slots;
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

function teamName(teams: Team[], teamId: number) {
  return teams.find((t) => t.id === teamId)?.name ?? "";
}

function groupByPos(list: Player[]) {
  const by: Record<Position, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of list) by[p.position].push(p);
  return by;
}

type SwapSource = { area: "xi" | "bench"; slotId: string } | null;

export type SavePayload =
  | { mode: "squad15"; squad: Player[] }
  | { mode: "standard"; startingXI: Player[]; bench: Player[]; formation: FormationKey };

interface Props {
  players: Player[]; // full db list (used in transfers picker)
  teams: Team[];

  // standard layout inputs
  initial?: Player[];
  initialBench?: Player[];
  initialSquad?: Player[]; // IMPORTANT: 15-man pool for standard (locks substitutions)

  // transfers layout input
  transfersSquad?: Player[]; // optional seed for squad15 UI

  onSave: (payload: SavePayload) => void;
  budget?: number;
  readOnly?: boolean;

  layout?: "standard" | "squad15";
  hideFormation?: boolean;
  initialFormation?: FormationKey;
}

export const StartingXI: FC<Props> = ({
  players,
  teams,
  initial = [],
  initialBench = [],
  initialSquad = [],
  transfersSquad = [],
  onSave,
  budget = 100,
  readOnly = false,
  layout = "standard",
  hideFormation = false,
  initialFormation = "4-4-2",
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isSquad15 = layout === "squad15";

  const [formation, setFormation] = useState<FormationKey>(initialFormation);
  const [slots, setSlots] = useState<Slot[]>(() =>
    isSquad15 ? buildSquad15Slots() : buildStandardSlots(initialFormation)
  );

  const [xiAssign, setXiAssign] = useState<Record<string, Player | null>>({});
  const [benchAssign, setBenchAssign] = useState<Record<string, Player | null>>({});

  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [swapSource, setSwapSource] = useState<SwapSource>(null);

  // close popups on outside click
  useEffect(() => {
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        setOpenSlot(null);
        setSwapSource(null);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, []);

  // STANDARD pool is LOCKED to squad (15). fallback to xi+bench union if missing
  const poolPlayers = useMemo(() => {
    if (initialSquad.length > 0) return uniqById(initialSquad);
    return uniqById([...initial, ...initialBench]);
  }, [initialSquad, initial, initialBench]);

  // pick source for popups:
  // - squad15: allow selecting from ALL players
  // - standard: allow selecting ONLY from squad pool (no adding outside squad)
  const pickerSource = isSquad15 ? players : poolPlayers;

  // init / sync
  useEffect(() => {
    if (isSquad15) {
      const s = buildSquad15Slots();
      setSlots(s);

      const map: Record<string, Player | null> = {};
      s.forEach((sl) => (map[sl.id] = null));

      // seed from transfersSquad if provided
      const seed = uniqById(transfersSquad);
      if (seed.length > 0) {
        const by = groupByPos(seed);
        (Object.keys(by) as Position[]).forEach((pos) => by[pos].sort((a, b) => a.id - b.id));
        for (const sl of s) map[sl.id] = by[sl.position].shift() ?? null;
      }

      setXiAssign(map);
      setBenchAssign({});
      setFormation(initialFormation);
      setOpenSlot(null);
      setSwapSource(null);
      return;
    }

    // STANDARD
    setFormation(initialFormation);
    const s = buildStandardSlots(initialFormation);
    setSlots(s);

    // XI assignment by position from provided initial XI
    const xiMap: Record<string, Player | null> = {};
    s.forEach((sl) => (xiMap[sl.id] = null));

    const remainingXI = [...initial];
    for (const sl of s) {
      const idx = remainingXI.findIndex((p) => p.position === sl.position);
      if (idx >= 0) {
        xiMap[sl.id] = remainingXI[idx];
        remainingXI.splice(idx, 1);
      }
    }

    // bench order matters and is EXACT
    const bMap: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((b) => (bMap[b.id] = null));
    bMap["bench-gk"] = initialBench[0] ?? null;
    bMap["bench-1"] = initialBench[1] ?? null;
    bMap["bench-2"] = initialBench[2] ?? null;
    bMap["bench-3"] = initialBench[3] ?? null;

    setXiAssign(xiMap);
    setBenchAssign(bMap);
    setOpenSlot(null);
    setSwapSource(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSquad15, initialFormation, transfersSquad, initial, initialBench, initialSquad]);

  const xiPlayers = useMemo(() => Object.values(xiAssign).filter(Boolean) as Player[], [xiAssign]);
  const benchPlayers = useMemo(
    () => (isSquad15 ? [] : (Object.values(benchAssign).filter(Boolean) as Player[])),
    [benchAssign, isSquad15]
  );

  const pickedIds = useMemo(() => new Set<number>([...xiPlayers, ...benchPlayers].map((p) => p.id)), [xiPlayers, benchPlayers]);

  const totalValue = useMemo(() => [...xiPlayers, ...benchPlayers].reduce((s, p) => s + p.value, 0), [xiPlayers, benchPlayers]);
  const remainingBudget = useMemo(() => budget - totalValue, [budget, totalValue]);

  // ===== VALIDATION =====
  const f = FORMATIONS[formation];

  const xiCounts = useMemo(() => {
    const c: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of xiPlayers) c[p.position] += 1;
    return c;
  }, [xiPlayers]);

  function isValidStandard() {
    if (xiPlayers.length !== 11) return false;
    if (benchPlayers.length !== 4) return false;

    if (xiCounts.GK !== 1) return false;
    if (xiCounts.DEF !== f.DEF) return false;
    if (xiCounts.MID !== f.MID) return false;
    if (xiCounts.FWD !== f.FWD) return false;

    // bench composition: [GK, field, field, field]
    const b0 = benchAssign["bench-gk"];
    if (!b0 || b0.position !== "GK") return false;
    for (const id of ["bench-1", "bench-2", "bench-3"] as const) {
      const p = benchAssign[id];
      if (!p || p.position === "GK") return false;
    }

    // locked to squad: must not contain outside players
    if (poolPlayers.length > 0) {
      const poolSet = new Set(poolPlayers.map((p) => p.id));
      for (const p of [...xiPlayers, ...benchPlayers]) {
        if (!poolSet.has(p.id)) return false;
      }
    }

    return remainingBudget >= 0;
  }

  function isValidSquad15() {
    return xiPlayers.length === 15 && remainingBudget >= 0;
  }

  // ===== ASSIGN / REPLACE (squad15 must support replacement) =====
function assignToSlot(slotId: string, p: Player) {
  if (readOnly) return;

  const current = xiAssign[slotId] ?? null;

  // allow replacing the player in THIS slot
  if (pickedIds.has(p.id) && current?.id !== p.id) return;

  // budget check must consider replacement
  const nextTotal =
    totalValue - (current?.value ?? 0) + p.value;

  if (nextTotal > budget) return;

  setXiAssign((prev) => ({
    ...prev,
    [slotId]: p,
  }));

  setOpenSlot(null);
}

  function removeFromSlot(slotId: string) {
    if (readOnly) return;
    setXiAssign((prev) => ({ ...prev, [slotId]: null }));
    setOpenSlot(null);
    setSwapSource(null);
  }

  function assignToBench(slotId: string, kind: "GK" | "FIELD", p: Player) {
    if (readOnly) return;

    const current = benchAssign[slotId];

    if (pickedIds.has(p.id) && current?.id !== p.id) return;

    if (kind === "GK" && p.position !== "GK") return;
    if (kind === "FIELD" && p.position === "GK") return;

    const nextTotal = totalValue - (current?.value ?? 0) + p.value;
    if (nextTotal > budget) return;

    setBenchAssign((prev) => ({ ...prev, [slotId]: p }));
    setOpenSlot(null);
  }

  function removeFromBench(slotId: string) {
    if (readOnly) return;
    setBenchAssign((prev) => ({ ...prev, [slotId]: null }));
    setOpenSlot(null);
    setSwapSource(null);
  }

  // ===== SWAP (standard only) =====
  function beginSwap(area: "xi" | "bench", slotId: string) {
    if (readOnly) return;
    if (isSquad15) return;

    const p = area === "xi" ? xiAssign[slotId] : benchAssign[slotId];
    if (!p) return;

    setSwapSource({ area, slotId });
    setOpenSlot(null);
  }

  function trySwap(targetArea: "xi" | "bench", targetSlotId: string) {
    if (readOnly) return;
    if (isSquad15) return;
    if (!swapSource) return;
    if (swapSource.area === targetArea) return;

    const srcP = swapSource.area === "xi" ? xiAssign[swapSource.slotId] : benchAssign[swapSource.slotId];
    const dstP = targetArea === "xi" ? xiAssign[targetSlotId] : benchAssign[targetSlotId];
    if (!srcP || !dstP) return;

    // determine actual XI slot + bench slot ids
    const xiSlotId = targetArea === "xi" ? targetSlotId : swapSource.slotId;
    const benchSlotId = targetArea === "bench" ? targetSlotId : swapSource.slotId;

    const xiSlot = slots.find((s) => s.id === xiSlotId);
    const benchSlot = BENCH_SLOTS.find((b) => b.id === benchSlotId);
    if (!xiSlot || !benchSlot) return;

    // which players will land where
    const incomingToXI = targetArea === "xi" ? srcP : dstP;
    const incomingToBench = targetArea === "bench" ? srcP : dstP;

    // position rules
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

  // ===== FORMATION CHANGE (standard only, rebuild from 15-man pool) =====
  function applyFormation(next: FormationKey) {
    if (readOnly) return;
    if (isSquad15) return;

    const pool = uniqById(poolPlayers.length ? poolPlayers : [...xiPlayers, ...benchPlayers]);
    if (pool.length === 0) {
      setFormation(next);
      setSlots(buildStandardSlots(next));
      return;
    }

    const nextSlots = buildStandardSlots(next);
    const req = FORMATIONS[next];

    // Build by position, keeping stable order by current appearance (XI then bench)
    const currentOrder = uniqById([...xiPlayers, ...benchPlayers, ...pool]);
    const by = groupByPos(currentOrder);

    const xiMap: Record<string, Player | null> = {};
    nextSlots.forEach((sl) => (xiMap[sl.id] = null));

    // GK
    xiMap["gk-1"] = by.GK.shift() ?? null;

    const fill = (pos: "DEF" | "MID" | "FWD", count: number) => {
      const row = nextSlots.filter((s) => s.position === pos);
      for (let i = 0; i < count; i++) xiMap[row[i].id] = by[pos].shift() ?? null;
    };

    fill("DEF", req.DEF);
    fill("MID", req.MID);
    fill("FWD", req.FWD);

    // bench (ordered): GK then 3 field
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
    setOpenSlot(null);
    setSwapSource(null);
  }

  function handleSave() {
    if (isSquad15) {
      const picked = slots.map((s) => xiAssign[s.id]).filter(Boolean) as Player[];
      onSave({ mode: "squad15", squad: picked });
      return;
    }
    onSave({ mode: "standard", startingXI: xiPlayers, bench: benchPlayers, formation });
  }

  const saveDisabled = isSquad15 ? !isValidSquad15() : !isValidStandard();

  // ===== UI pieces =====
  const Row = ({ position, label }: { position: Position; label: string }) => {
    const rowSlots = slots.filter((s) => s.position === position);

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length}`}>
        {rowSlots.map((s) => {
          const assigned = xiAssign[s.id];
          const isOpen = openSlot === s.id;
          const canSwap = !isSquad15 && !readOnly;

          const available = pickerSource
            .filter((p) => {
              if (p.position !== s.position) return false;
              const current = xiAssign[s.id];
              if (current && p.id === current.id) return true; // allow current in list
              return !pickedIds.has(p.id);
            })
            .map((p) => ({
              ...p,
              teamName: teamName(teams, p.teamId),
              willExceed: totalValue - (assigned?.value ?? 0) + p.value > budget,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

          return (
            <div
              key={s.id}
              className={`slot ${assigned ? "slot-filled" : ""} ${isOpen ? "slot-open" : ""}`}
              onClick={() => {
                if (readOnly) return;

                // if swapping from bench -> clicking XI player swaps
                if (swapSource && swapSource.area === "bench" && assigned) {
                  trySwap("xi", s.id);
                  return;
                }

                // squad15: allow open even if filled (replacement)
                if (isSquad15) {
                  setOpenSlot(isOpen ? null : s.id);
                  return;
                }

                // standard: open only empty slots (normally shouldn’t exist)
                if (!assigned) setOpenSlot(isOpen ? null : s.id);
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

                  {!readOnly && (
                    <button
                      type="button"
                      className="remove-slot"
                      title="Poista"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromSlot(s.id);
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
              ) : (
                <div className="slot-empty">{label}</div>
              )}

              {isOpen && !readOnly && (
                <div className="slot-pop" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                  <div className="slot-pop-title">Valitse pelaaja</div>

                  <div className="slot-pop-list">
                    {available.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="slot-pop-btn"
                        onClick={() => assignToSlot(s.id, p)}
                        disabled={p.willExceed}
                        title={p.willExceed ? "Budjetti ei riitä" : undefined}
                      >
                        <span className="slot-pop-name">{p.name}</span>
                        <span className="slot-pop-team">{p.teamName}</span>
                        <span className="slot-pop-price">{p.value.toFixed(1)} M</span>
                      </button>
                    ))}
                    {available.length === 0 && <div className="slot-pop-empty">Ei saatavilla</div>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const Bench = () => {
    if (isSquad15) return null;

    return (
      <div className="bench">
        <h3 className="app-h2" style={{ marginTop: 16 }}>
          Penkki
        </h3>

        <div className="bench-row">
          {BENCH_SLOTS.map((s) => {
            const assigned = benchAssign[s.id] ?? null;
            const isOpen = openSlot === s.id;

            const available = pickerSource
              .filter((p) => {
                const current = benchAssign[s.id];
                if (current && p.id === current.id) return true;

                if (pickedIds.has(p.id)) return false;
                if (s.kind === "GK") return p.position === "GK";
                return p.position !== "GK";
              })
              .map((p) => ({
                ...p,
                teamName: teamName(teams, p.teamId),
                willExceed: totalValue - (assigned?.value ?? 0) + p.value > budget,
              }))
              .sort((a, b) => a.name.localeCompare(b.name));

            return (
              <div
                key={s.id}
                className={`slot ${assigned ? "slot-filled" : ""} ${isOpen ? "slot-open" : ""}`}
                onClick={() => {
                  if (readOnly) return;

                  // swapping from XI -> clicking bench player swaps
                  if (swapSource && swapSource.area === "xi" && assigned) {
                    trySwap("bench", s.id);
                    return;
                  }

                  // only open picker for empty bench slots (normally shouldn’t exist)
                  if (!assigned) setOpenSlot(isOpen ? null : s.id);
                }}
                role="button"
                tabIndex={0}
              >
                {assigned ? (
                  <div className="player-chip">
                    <div className="player-name">{assigned.name}</div>
                    <div className="player-team">{teamName(teams, assigned.teamId)}</div>

                    {!readOnly && (
                      <>
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

                        <button
                          type="button"
                          className="remove-slot"
                          title="Poista"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromBench(s.id);
                          }}
                        >
                          ×
                        </button>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="slot-empty">{s.label}</div>
                )}

                {isOpen && !readOnly && (
                  <div className="slot-pop" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                    <div className="slot-pop-title">Valitse pelaaja</div>
                    <div className="slot-pop-list">
                      {available.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          className="slot-pop-btn"
                          onClick={() => assignToBench(s.id, s.kind, p)}
                          disabled={p.willExceed}
                          title={p.willExceed ? "Budjetti ei riitä" : undefined}
                        >
                          <span className="slot-pop-name">{p.name}</span>
                          <span className="slot-pop-team">{p.teamName}</span>
                          <span className="slot-pop-price">{p.value.toFixed(1)} M</span>
                        </button>
                      ))}
                      {available.length === 0 && <div className="slot-pop-empty">Ei saatavilla</div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {swapSource && (
          <div className="starting-xi-warning" role="alert" style={{ marginTop: 8, opacity: 0.9 }}>
            Vaihto valittu — klikkaa vastapuolen pelaajaa tai ⇄.
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
          <h2>{isSquad15 ? "Vaihdot (15)" : "Avauskokoonpano"}</h2>

          <div className="app-muted" style={{ marginBottom: 8 }}>
            Budjetti jäljellä: <b>{remainingBudget.toFixed(1)} M</b>
          </div>

          {!isSquad15 && !hideFormation && (
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
          )}

          {!isSquad15 && !isValidStandard() && (
            <div className="starting-xi-warning" role="alert">
              Avaus / penkki ei ole kelvollinen.
            </div>
          )}
          {isSquad15 && !isValidSquad15() && (
            <div className="starting-xi-warning" role="alert">
              Valitse 15 pelaajaa (2 MV, 5 P, 5 KK, 3 H).
            </div>
          )}
        </header>

        <div className="pitch">
          <Row position="GK" label="MV" />
          <Row position="DEF" label="P" />
          <Row position="MID" label="KK" />
          <Row position="FWD" label="H" />
        </div>

        <Bench />

        <div className="starting-xi-controls">
          {!readOnly && (
            <button type="button" className="xi-save" onClick={handleSave} disabled={saveDisabled}>
              Tallenna
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default StartingXI;