// client/src/StartingXI.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { FC } from "react";

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

type Slot = { id: string; position: Player["position"]; label: string };
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

// Transfers: 15 slots (2/5/5/3)
function buildSquad15Slots(): Slot[] {
  const slots: Slot[] = [];
  slots.push({ id: "sq-gk-1", position: "GK", label: "MV" });
  slots.push({ id: "sq-gk-2", position: "GK", label: "MV" });
  for (let i = 1; i <= 5; i++) slots.push({ id: `sq-def-${i}`, position: "DEF", label: "P" });
  for (let i = 1; i <= 5; i++) slots.push({ id: `sq-mid-${i}`, position: "MID", label: "KK" });
  for (let i = 1; i <= 3; i++) slots.push({ id: `sq-fwd-${i}`, position: "FWD", label: "H" });
  return slots;
}

function teamName(teams: Team[], teamId: number) {
  return teams.find((t) => t.id === teamId)?.name ?? "";
}

export type SavePayload = { startingXI: Player[]; bench: Player[]; formation?: FormationKey };

interface Props {
  players: Player[];
  teams: Team[];
  initial?: Player[];
  initialBench?: Player[];
  onSave: (payload: SavePayload) => void;
  budget?: number;
  readOnly?: boolean;

  layout?: "standard" | "squad15";
  hideFormation?: boolean;

  // ✅ NEW: persisted formation
  initialFormation?: FormationKey;
}

export const StartingXI: FC<Props> = ({
  players,
  teams,
  initial = [],
  initialBench = [],
  onSave,
  budget = 100,
  readOnly = false,

  layout = "standard",
  hideFormation = false,
  initialFormation = "4-4-2",
}) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isSquad15 = layout === "squad15";

  // STANDARD formation state (persisted)
  const [formation, setFormation] = useState<FormationKey>(initialFormation);

  // slots & assignments
  const [xiSlots, setXiSlots] = useState<Slot[]>(() =>
    isSquad15 ? buildSquad15Slots() : buildStandardSlots(initialFormation)
  );

  const [xiAssign, setXiAssign] = useState<Record<string, Player | null>>(() => {
    const base = isSquad15 ? buildSquad15Slots() : buildStandardSlots(initialFormation);
    const map: Record<string, Player | null> = {};
    base.forEach((s) => (map[s.id] = null));

    const seed = isSquad15 ? [...initial, ...initialBench] : [...initial];
    const remaining = [...seed];
    for (const s of base) {
      const idx = remaining.findIndex((p) => p.position === s.position);
      if (idx >= 0) {
        map[s.id] = remaining[idx];
        remaining.splice(idx, 1);
      }
    }
    return map;
  });

  const [benchAssign, setBenchAssign] = useState<Record<string, Player | null>>(() => {
    const map: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (map[s.id] = null));
    if (isSquad15) return map;

    const gk = initialBench.find((p) => p.position === "GK") ?? null;
    const field = initialBench.filter((p) => p.position !== "GK").slice(0, 3);
    map["bench-gk"] = gk;
    map["bench-1"] = field[0] ?? null;
    map["bench-2"] = field[1] ?? null;
    map["bench-3"] = field[2] ?? null;
    return map;
  });

  const [openSlot, setOpenSlot] = useState<string | null>(null);

  // ✅ Keep formation in sync when parent loads saved team (refresh/tab change)
  useEffect(() => {
    if (isSquad15) return;

    setFormation(initialFormation);
    const base = buildStandardSlots(initialFormation);
    setXiSlots(base);

    const map: Record<string, Player | null> = {};
    base.forEach((s) => (map[s.id] = null));

    const remaining = [...initial];
    for (const s of base) {
      const idx = remaining.findIndex((p) => p.position === s.position);
      if (idx >= 0) {
        map[s.id] = remaining[idx];
        remaining.splice(idx, 1);
      }
    }
    setXiAssign(map);

    const bmap: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (bmap[s.id] = null));
    const gk = initialBench.find((p) => p.position === "GK") ?? null;
    const field = initialBench.filter((p) => p.position !== "GK").slice(0, 3);
    bmap["bench-gk"] = gk;
    bmap["bench-1"] = field[0] ?? null;
    bmap["bench-2"] = field[1] ?? null;
    bmap["bench-3"] = field[2] ?? null;
    setBenchAssign(bmap);

    setOpenSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFormation, initial, initialBench, isSquad15]);

  // click outside closes popup
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

  const xiPlayers = useMemo(() => Object.values(xiAssign).filter(Boolean) as Player[], [xiAssign]);
  const benchPlayers = useMemo(
    () => (isSquad15 ? [] : ((Object.values(benchAssign).filter(Boolean) as Player[]) ?? [])),
    [benchAssign, isSquad15]
  );

  // ✅ Formation change rebuild keeping players pool (same logic you already had)
  function applyFormation(next: FormationKey) {
    if (readOnly) return;
    if (isSquad15) return;

    const nextSlots = buildStandardSlots(next);
    const pool = [...xiPlayers, ...benchPlayers];

    const byPos: Record<Player["position"], Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const p of pool) byPos[p.position].push(p);

    const nextMap: Record<string, Player | null> = {};
    nextSlots.forEach((s) => (nextMap[s.id] = null));

    // fill GK
    nextMap["gk-1"] = byPos.GK.shift() ?? null;

    const f = FORMATIONS[next];
    const fill = (pos: "DEF" | "MID" | "FWD", count: number) => {
      const slotsForPos = nextSlots.filter((s) => s.position === pos);
      for (let i = 0; i < count; i++) {
        const p = byPos[pos].shift() ?? null;
        if (p) nextMap[slotsForPos[i].id] = p;
      }
    };

    fill("DEF", f.DEF);
    fill("MID", f.MID);
    fill("FWD", f.FWD);

    // rebuild bench from leftovers (random ok)
    const nextBench: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (nextBench[s.id] = null));
    nextBench["bench-gk"] = byPos.GK.shift() ?? null;
    const leftoverField = [...byPos.DEF, ...byPos.MID, ...byPos.FWD];
    nextBench["bench-1"] = leftoverField[0] ?? null;
    nextBench["bench-2"] = leftoverField[1] ?? null;
    nextBench["bench-3"] = leftoverField[2] ?? null;

    setFormation(next);
    setXiSlots(nextSlots);
    setXiAssign(nextMap);
    setBenchAssign(nextBench);
    setOpenSlot(null);
  }

  // (rest of UI code can stay as you already have; only save now includes formation)

  const Row = ({ position, label }: { position: Player["position"]; label: string }) => {
    const rowSlots = xiSlots.filter((s) => s.position === position);

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length}`}>
        {rowSlots.map((s) => {
          const assigned = xiAssign[s.id];
          const isOpen = openSlot === s.id;

          const available = players
            .filter((p) => p.position === s.position && ![...xiPlayers, ...benchPlayers].some((x) => x.id === p.id))
            .map((p) => ({ ...p, teamName: teamName(teams, p.teamId) }))
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
                  <div className="player-team">{teamName(teams, assigned.teamId)}</div>
                  {!readOnly && (
                    <button
                      type="button"
                      className="remove-slot"
                      onClick={(e) => {
                        e.stopPropagation();
                        setXiAssign((prev) => ({ ...prev, [s.id]: null }));
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
                      <button
                        key={p.id}
                        type="button"
                        className="slot-pop-btn"
                        onClick={() => {
                          setXiAssign((prev) => ({ ...prev, [s.id]: p }));
                          setOpenSlot(null);
                        }}
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

  const Bench = () => {
    if (isSquad15) return null;

    return (
      <div className="bench">
        <h3 className="app-h2" style={{ marginTop: 16 }}>
          Penkki
        </h3>
        <div className="bench-row">
          {BENCH_SLOTS.map((s) => {
            const assigned = benchAssign[s.id];
            const isOpen = openSlot === s.id;

            const available = players
              .filter((p) => {
                const picked = [...xiPlayers, ...benchPlayers].some((x) => x.id === p.id);
                if (picked) return false;
                if (s.kind === "GK") return p.position === "GK";
                return p.position !== "GK";
              })
              .map((p) => ({ ...p, teamName: teamName(teams, p.teamId) }))
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
                    <div className="player-team">{teamName(teams, assigned.teamId)}</div>
                    {!readOnly && (
                      <button
                        type="button"
                        className="remove-slot"
                        onClick={(e) => {
                          e.stopPropagation();
                          setBenchAssign((prev) => ({ ...prev, [s.id]: null }));
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
                          onClick={() => {
                            setBenchAssign((prev) => ({ ...prev, [s.id]: p }));
                            setOpenSlot(null);
                          }}
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
      </div>
    );
  };

  return (
    <div className="starting-xi-root" ref={rootRef}>
      <div className="starting-xi-card">
        <header className="starting-xi-header">
          <h2>{isSquad15 ? "Vaihdot (15)" : "Avauskokoonpano"}</h2>

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
            <button
              type="button"
              className="xi-save"
              onClick={() => onSave({ startingXI: xiPlayers, bench: benchPlayers, formation: isSquad15 ? undefined : formation })}
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