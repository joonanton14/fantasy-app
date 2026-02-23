// client/src/StartingXI.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

export interface Player {
  id: number;
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  teamId: number;
  value: number;
}

export interface Team {
  id: number;
  name: string;
}

export type FormationKey = "3-5-2" | "3-4-3" | "4-4-2" | "4-3-3" | "4-5-1" | "5-3-2" | "5-4-1";

const FORMATIONS: Record<FormationKey, { DEF: number; MID: number; FWD: number }> = {
  "3-5-2": { DEF: 3, MID: 5, FWD: 2 },
  "3-4-3": { DEF: 3, MID: 4, FWD: 3 },
  "4-4-2": { DEF: 4, MID: 4, FWD: 2 },
  "4-3-3": { DEF: 4, MID: 3, FWD: 3 },
  "4-5-1": { DEF: 4, MID: 5, FWD: 1 },
  "5-3-2": { DEF: 5, MID: 3, FWD: 2 },
  "5-4-1": { DEF: 5, MID: 4, FWD: 1 },
};

type Slot = { id: string; position: Player["position"] };

function buildSlots(formation: FormationKey): Slot[] {
  const f = FORMATIONS[formation];
  const slots: Slot[] = [{ id: "gk-1", position: "GK" }];
  for (let i = 1; i <= f.DEF; i++) slots.push({ id: `def-${i}`, position: "DEF" });
  for (let i = 1; i <= f.MID; i++) slots.push({ id: `mid-${i}`, position: "MID" });
  for (let i = 1; i <= f.FWD; i++) slots.push({ id: `fwd-${i}`, position: "FWD" });
  return slots;
}

function countByPos(list: Player[], pos: Player["position"]) {
  return list.filter((p) => p.position === pos).length;
}

function inferFormationFromXI(xi: Player[]): FormationKey | null {
  const gk = countByPos(xi, "GK");
  const def = countByPos(xi, "DEF");
  const mid = countByPos(xi, "MID");
  const fwd = countByPos(xi, "FWD");
  if (gk !== 1) return null;

  const hit = (Object.keys(FORMATIONS) as FormationKey[]).find((k) => {
    const f = FORMATIONS[k];
    return f.DEF === def && f.MID === mid && f.FWD === fwd;
  });

  return hit ?? null;
}

type BenchSlot = { id: string; label: string; kind: "GK" | "FIELD" };

const BENCH_SLOTS: BenchSlot[] = [
  { id: "bench-gk", label: "MV", kind: "GK" },
  { id: "bench-1", label: "PENKKI", kind: "FIELD" },
  { id: "bench-2", label: "PENKKI", kind: "FIELD" },
  { id: "bench-3", label: "PENKKI", kind: "FIELD" },
];

export type SavePayload = { startingXI: Player[]; bench: Player[] };

export interface StartingXIProps {
  players: Player[];
  teams: Team[];
  initial?: Player[];
  initialBench?: Player[];
  onSave: (payload: SavePayload) => void;
  budget?: number;
  readOnly?: boolean;

  mode?: "builder" | "transfers";
  hideBench?: boolean; // true hides, false shows, undefined -> default
  hideFormation?: boolean; // true hides, false shows, undefined -> default
  fixedFormation?: FormationKey;

  // ✅ NEW:
  layout?: "standard" | "all15"; // all15 = show 4 bench slots on pitch, no bench section
}

export function StartingXI({
  players,
  teams,
  initial = [],
  initialBench = [],
  onSave,
  budget = 100,
  readOnly = false,

  mode = "builder",
  hideBench,
  hideFormation,
  fixedFormation,

  layout = "standard",
}: StartingXIProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isTransfers = mode === "transfers";

  // Optional overrides
  const showBench = hideBench === undefined ? !isTransfers : !hideBench;
  const showFormation = hideFormation === undefined ? !isTransfers : !hideFormation;

  const benchOnPitch = layout === "all15";
  const showBenchSection = showBench && !benchOnPitch; // ✅ hide bench section in all15

  const inferred = inferFormationFromXI(initial);

  const initialFormation: FormationKey = isTransfers
    ? (fixedFormation ?? inferred ?? "4-4-2")
    : (inferred ?? "4-4-2");

  const [formation, setFormation] = useState<FormationKey>(initialFormation);
  const [slots, setSlots] = useState<Slot[]>(() => buildSlots(initialFormation));

  const [slotAssignments, setSlotAssignments] = useState<Record<string, Player | null>>(() => {
    const baseSlots = buildSlots(initialFormation);
    const map: Record<string, Player | null> = {};
    baseSlots.forEach((s) => (map[s.id] = null));

    const remaining = [...initial];
    for (const s of baseSlots) {
      const idx = remaining.findIndex((p) => p.position === s.position);
      if (idx >= 0) {
        map[s.id] = remaining[idx];
        remaining.splice(idx, 1);
      }
    }
    return map;
  });

  const [benchAssignments, setBenchAssignments] = useState<Record<string, Player | null>>(() => {
    const map: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (map[s.id] = null));

    // even if bench section is hidden, we still maintain bench assignments
    if (!showBench) return map;

    const gk = initialBench.find((p) => p.position === "GK") ?? null;
    const field = initialBench.filter((p) => p.position !== "GK").slice(0, 3);

    map["bench-gk"] = gk;
    map["bench-1"] = field[0] ?? null;
    map["bench-2"] = field[1] ?? null;
    map["bench-3"] = field[2] ?? null;

    return map;
  });

  const [openSlot, setOpenSlot] = useState<string | null>(null);

  // Sync when parent updates
  useEffect(() => {
    const inferredNow = inferFormationFromXI(initial);

    const effectiveFormation: FormationKey = isTransfers
      ? (fixedFormation ?? inferredNow ?? "4-4-2")
      : (inferredNow ?? formation);

    const baseSlots = buildSlots(effectiveFormation);
    const map: Record<string, Player | null> = {};
    baseSlots.forEach((s) => (map[s.id] = null));

    const remaining = [...initial];
    for (const s of baseSlots) {
      const idx = remaining.findIndex((p) => p.position === s.position);
      if (idx >= 0) {
        map[s.id] = remaining[idx];
        remaining.splice(idx, 1);
      }
    }

    const bmap: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (bmap[s.id] = null));
    if (showBench) {
      const gk = initialBench.find((p) => p.position === "GK") ?? null;
      const field = initialBench.filter((p) => p.position !== "GK").slice(0, 3);
      bmap["bench-gk"] = gk;
      bmap["bench-1"] = field[0] ?? null;
      bmap["bench-2"] = field[1] ?? null;
      bmap["bench-3"] = field[2] ?? null;
    }

    setFormation(effectiveFormation);
    setSlots(baseSlots);
    setSlotAssignments(map);
    setBenchAssignments(bmap);
    setOpenSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, initialBench, showBench, isTransfers, fixedFormation]);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpenSlot(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, []);

  const xiPlayers = useMemo(() => Object.values(slotAssignments).filter(Boolean) as Player[], [slotAssignments]);
  const benchPlayers = useMemo(
    () => (showBench ? (Object.values(benchAssignments).filter(Boolean) as Player[]) : []),
    [benchAssignments, showBench]
  );

  const totalValue = useMemo(() => [...xiPlayers, ...benchPlayers].reduce((sum, p) => sum + p.value, 0), [
    xiPlayers,
    benchPlayers,
  ]);
  const remainingBudget = useMemo(() => budget - totalValue, [budget, totalValue]);

  const f = FORMATIONS[formation];
  const counts = (pos: Player["position"]) => countByPos(xiPlayers, pos);
  const teamCountAll = (teamId: number) => [...xiPlayers, ...benchPlayers].filter((p) => p.teamId === teamId).length;

  const LIMITS = useMemo(
    () => ({
      GK: { min: 1, max: 1 },
      DEF: { min: f.DEF, max: f.DEF },
      MID: { min: f.MID, max: f.MID },
      FWD: { min: f.FWD, max: f.FWD },
    }),
    [f.DEF, f.MID, f.FWD]
  );

  function isPickedAnywhere(id: number) {
    return [...xiPlayers, ...benchPlayers].some((p) => p.id === id);
  }

  function canAssignToXI(p: Player) {
    if (isPickedAnywhere(p.id)) return false;
    if (teamCountAll(p.teamId) >= 3) return false;

    const max = (LIMITS as any)[p.position].max as number;
    if (counts(p.position) >= max) return false;

    if (totalValue + p.value > budget) return false;
    return true;
  }

  function canAssignToBench(slotKind: "GK" | "FIELD", p: Player) {
    if (!showBench) return false;
    if (isPickedAnywhere(p.id)) return false;
    if (teamCountAll(p.teamId) >= 3) return false;

    if (slotKind === "GK" && p.position !== "GK") return false;
    if (slotKind === "FIELD" && p.position === "GK") return false;

    if (totalValue + p.value > budget) return false;
    return true;
  }

  function assignToXISlot(slotId: string, p: Player) {
    if (readOnly) return;
    if (!canAssignToXI(p)) return;
    setSlotAssignments((prev) => ({ ...prev, [slotId]: p }));
    setOpenSlot(null);
  }

  function removeFromXISlot(slotId: string) {
    if (readOnly) return;
    setSlotAssignments((prev) => ({ ...prev, [slotId]: null }));
  }

  function assignToBenchSlot(slotId: string, slotKind: "GK" | "FIELD", p: Player) {
    if (readOnly) return;
    if (!canAssignToBench(slotKind, p)) return;
    setBenchAssignments((prev) => ({ ...prev, [slotId]: p }));
    setOpenSlot(null);
  }

  function removeFromBenchSlot(slotId: string) {
    if (readOnly) return;
    setBenchAssignments((prev) => ({ ...prev, [slotId]: null }));
  }

  function isValidXI() {
    if (xiPlayers.length !== 11) return false;
    return (
      counts("GK") === LIMITS.GK.max &&
      counts("DEF") === LIMITS.DEF.max &&
      counts("MID") === LIMITS.MID.max &&
      counts("FWD") === LIMITS.FWD.max
    );
  }

  function isValidBench() {
    if (!showBench) return true;
    if (benchPlayers.length !== 4) return false;
    const gkCount = benchPlayers.filter((p) => p.position === "GK").length;
    const fieldCount = benchPlayers.filter((p) => p.position !== "GK").length;
    return gkCount === 1 && fieldCount === 3;
  }

  function applyFormation(next: FormationKey) {
    if (readOnly) return;
    if (isTransfers) return;

    const nextSlots = buildSlots(next);
    const nextReq = FORMATIONS[next];

    const xiNow = Object.values(slotAssignments).filter(Boolean) as Player[];
    const benchNow = Object.values(benchAssignments).filter(Boolean) as Player[];
    const pool = [...xiNow, ...benchNow];

    const poolByPos: Record<Player["position"], Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const p of pool) poolByPos[p.position].push(p);

    const nextMap: Record<string, Player | null> = {};
    nextSlots.forEach((s) => (nextMap[s.id] = null));

    const gkPick = poolByPos.GK.shift() ?? null;
    if (gkPick) nextMap["gk-1"] = gkPick;

    const fillPos = (pos: "DEF" | "MID" | "FWD", count: number) => {
      const slotsForPos = nextSlots.filter((s) => s.position === pos);
      for (let i = 0; i < count; i++) {
        const p = poolByPos[pos].shift() ?? null;
        if (p) nextMap[slotsForPos[i].id] = p;
      }
    };

    fillPos("DEF", nextReq.DEF);
    fillPos("MID", nextReq.MID);
    fillPos("FWD", nextReq.FWD);

    // keep bench map as-is (rebuild from leftovers)
    const nextBenchMap: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (nextBenchMap[s.id] = null));
    if (showBench) {
      const leftoverGK = poolByPos.GK.shift() ?? null;
      const leftoverField: Player[] = [...poolByPos.MID, ...poolByPos.DEF, ...poolByPos.FWD].filter(
        (p) => p.position !== "GK"
      );
      nextBenchMap["bench-gk"] = leftoverGK;
      nextBenchMap["bench-1"] = leftoverField[0] ?? null;
      nextBenchMap["bench-2"] = leftoverField[1] ?? null;
      nextBenchMap["bench-3"] = leftoverField[2] ?? null;
    }

    setFormation(next);
    setSlots(nextSlots);
    setSlotAssignments(nextMap);
    setBenchAssignments(nextBenchMap);
    setOpenSlot(null);
  }

  const saveDisabled = !(isValidXI() && isValidBench() && remainingBudget >= 0);

  const Row = ({ position, label }: { position: Player["position"]; label: string }) => {
    const rowSlots = slots.filter((s) => s.position === position);

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length}`}>
        {rowSlots.map((s) => {
          const assigned = slotAssignments[s.id];
          const isOpen = openSlot === s.id;

          const available = players
            .filter((p) => p.position === s.position && canAssignToXI(p))
            .map((p) => ({
              ...p,
              teamName: teams.find((t) => t.id === p.teamId)?.name ?? "",
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

          return (
            <div
              key={s.id}
              className={`slot ${assigned ? "slot-filled" : ""} ${isOpen ? "slot-open" : ""}`}
              onClick={() => {
                if (readOnly) return;
                setOpenSlot(isOpen ? null : s.id);
              }}
              role="button"
              tabIndex={0}
            >
              {assigned ? (
                <div className="player-chip">
                  <div className="player-name">{assigned.name}</div>
                  <div className="player-team">{teams.find((t) => t.id === assigned.teamId)?.name}</div>
                  {!readOnly && (
                    <button
                      type="button"
                      className="remove-slot"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromXISlot(s.id);
                      }}
                      aria-label="Remove player"
                      title="Remove"
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
                      <button key={p.id} type="button" className="slot-pop-btn" onClick={() => assignToXISlot(s.id, p)}>
                        <span className="slot-pop-name">{p.name}</span>
                        <span className="slot-pop-team">{p.teamName}</span>
                        <span className="slot-pop-price">{p.value.toFixed(1)} M</span>
                      </button>
                    ))}
                    {available.length === 0 && <div className="slot-pop-empty">Ei saatavilla olevia pelaajia</div>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ✅ NEW: bench slots rendered as an extra pitch row (4 columns) for Transfers
  const BenchOnPitchRow = () => {
    if (!benchOnPitch || !showBench) return null;

    return (
      <div className="pitch-row pitch-cols-4">
        {BENCH_SLOTS.map((s) => {
          const assigned = benchAssignments[s.id];
          const isOpen = openSlot === s.id;

          const available = players
            .filter((p) => canAssignToBench(s.kind, p))
            .map((p) => ({
              ...p,
              teamName: teams.find((t) => t.id === p.teamId)?.name ?? "",
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

          return (
            <div
              key={s.id}
              className={`slot ${assigned ? "slot-filled" : ""} ${isOpen ? "slot-open" : ""}`}
              onClick={() => {
                if (readOnly) return;
                setOpenSlot(isOpen ? null : s.id);
              }}
              role="button"
              tabIndex={0}
            >
              {assigned ? (
                <div className="player-chip">
                  <div className="player-name">{assigned.name}</div>
                  <div className="player-team">{teams.find((t) => t.id === assigned.teamId)?.name}</div>
                  {!readOnly && (
                    <button
                      type="button"
                      className="remove-slot"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromBenchSlot(s.id);
                      }}
                      aria-label="Remove player"
                      title="Remove"
                    >
                      ×
                    </button>
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
                        onClick={() => assignToBenchSlot(s.id, s.kind, p)}
                      >
                        <span className="slot-pop-name">{p.name}</span>
                        <span className="slot-pop-team">{p.teamName}</span>
                        <span className="slot-pop-price">{p.value.toFixed(1)} M</span>
                      </button>
                    ))}
                    {available.length === 0 && <div className="slot-pop-empty">Ei saatavilla olevia pelaajia</div>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const BenchSection = () => {
    if (!showBenchSection) return null;

    return (
      <div className="bench">
        <h3 className="app-h2" style={{ marginTop: 16 }}>
          Penkki
        </h3>
        <div className="bench-row">
          {BENCH_SLOTS.map((s) => {
            const assigned = benchAssignments[s.id];
            const isOpen = openSlot === s.id;

            const available = players
              .filter((p) => canAssignToBench(s.kind, p))
              .map((p) => ({
                ...p,
                teamName: teams.find((t) => t.id === p.teamId)?.name ?? "",
              }))
              .sort((a, b) => a.name.localeCompare(b.name));

            return (
              <div
                key={s.id}
                className={`slot ${assigned ? "slot-filled" : ""} ${isOpen ? "slot-open" : ""}`}
                onClick={() => {
                  if (readOnly) return;
                  setOpenSlot(isOpen ? null : s.id);
                }}
                role="button"
                tabIndex={0}
              >
                {assigned ? (
                  <div className="player-chip">
                    <div className="player-name">{assigned.name}</div>
                    <div className="player-team">{teams.find((t) => t.id === assigned.teamId)?.name}</div>
                    {!readOnly && (
                      <button
                        type="button"
                        className="remove-slot"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeFromBenchSlot(s.id);
                        }}
                        aria-label="Poista pelaaja"
                        title="Poista"
                      >
                        ×
                      </button>
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
                          onClick={() => assignToBenchSlot(s.id, s.kind, p)}
                        >
                          <span className="slot-pop-name">{p.name}</span>
                          <span className="slot-pop-team">{p.teamName}</span>
                          <span className="slot-pop-price">{p.value.toFixed(1)} M</span>
                        </button>
                      ))}
                      {available.length === 0 && <div className="slot-pop-empty">Ei saatavilla olevia pelaajia</div>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {!isValidBench() && (
          <div className="starting-xi-warning" role="alert" style={{ marginTop: 8 }}>
            Valitse 1 maalivahti ja 3 kenttäpelaajaa.
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

          <div className="starting-xi-meta">
            {showFormation && (
              <div className="meta-pill meta-formation">
                <span>
                  Formaatio: <b>{formation}</b>
                </span>

                <select
                  className="formation-select"
                  value={formation}
                  onChange={(e) => applyFormation(e.target.value as FormationKey)}
                  aria-label="Select formation"
                  disabled={readOnly}
                >
                  {(Object.keys(FORMATIONS) as FormationKey[]).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {!isValidXI() && (
            <div className="starting-xi-warning" role="alert">
              Avaus ei ole kelvollinen.
            </div>
          )}
        </header>

        <div className="pitch">
          <Row position="GK" label="MV" />
          <Row position="DEF" label="P" />
          <Row position="MID" label="KK" />
          <Row position="FWD" label="H" />

          {/* ✅ Transfers layout: show 4 “bench” slots on the pitch */}
          <BenchOnPitchRow />
        </div>

        {/* ✅ Standard layout: show actual bench section below */}
        <BenchSection />

        <div className="starting-xi-controls">
          {!readOnly && (
            <button type="button" className="xi-save" onClick={() => onSave({ startingXI: xiPlayers, bench: benchPlayers })} disabled={saveDisabled}>
              Tallenna
            </button>
          )}
        </div>
      </div>
    </div>
  );
}