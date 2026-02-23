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

export type SavePayload = { startingXI: Player[]; bench: Player[] };

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
type BenchSlot = { id: string; kind: "GK" | "FIELD"; label: string };

const BENCH_SLOTS: BenchSlot[] = [
  { id: "bench-gk", kind: "GK", label: "MV" },
  { id: "bench-1", kind: "FIELD", label: "PENKKI" },
  { id: "bench-2", kind: "FIELD", label: "PENKKI" },
  { id: "bench-3", kind: "FIELD", label: "PENKKI" },
];

function teamName(teams: Team[], teamId: number) {
  return teams.find((t) => t.id === teamId)?.name ?? "";
}

function buildStandardSlots(formation: FormationKey): Slot[] {
  const f = FORMATIONS[formation];
  const slots: Slot[] = [{ id: "gk-1", position: "GK", label: "MV" }];
  for (let i = 1; i <= f.DEF; i++) slots.push({ id: `def-${i}`, position: "DEF", label: "P" });
  for (let i = 1; i <= f.MID; i++) slots.push({ id: `mid-${i}`, position: "MID", label: "KK" });
  for (let i = 1; i <= f.FWD; i++) slots.push({ id: `fwd-${i}`, position: "FWD", label: "H" });
  return slots;
}

// Transfers: fixed squad 15 (2/5/5/3)
function buildSquad15Slots(): Slot[] {
  const slots: Slot[] = [];
  slots.push({ id: "sq-gk-1", position: "GK", label: "MV" });
  slots.push({ id: "sq-gk-2", position: "GK", label: "MV" });
  for (let i = 1; i <= 5; i++) slots.push({ id: `sq-def-${i}`, position: "DEF", label: "P" });
  for (let i = 1; i <= 5; i++) slots.push({ id: `sq-mid-${i}`, position: "MID", label: "KK" });
  for (let i = 1; i <= 3; i++) slots.push({ id: `sq-fwd-${i}`, position: "FWD", label: "H" });
  return slots;
}

// Transfers save: split 15 into valid XI+bench (order doesn't matter, just must be valid)
function split15ToXIAndBench(squad: Player[]): SavePayload | null {
  const gk = squad.filter((p) => p.position === "GK");
  const def = squad.filter((p) => p.position === "DEF");
  const mid = squad.filter((p) => p.position === "MID");
  const fwd = squad.filter((p) => p.position === "FWD");
  if (gk.length !== 2 || def.length !== 5 || mid.length !== 5 || fwd.length !== 3) return null;

  // deterministic "random enough" split
  const startingXI: Player[] = [gk[0], ...def.slice(0, 4), ...mid.slice(0, 4), ...fwd.slice(0, 2)];
  const bench: Player[] = [gk[1], def[4], mid[4], fwd[2]];
  return { startingXI, bench };
}

export interface StartingXIProps {
  players: Player[];
  teams: Team[];
  initial?: Player[];
  initialBench?: Player[];
  onSave: (payload: SavePayload) => void;
  budget?: number;
  readOnly?: boolean;

  layout?: "standard" | "squad15";
  hideFormation?: boolean;
  defaultFormation?: FormationKey;
}

export function StartingXI({
  players,
  teams,
  initial = [],
  initialBench = [],
  onSave,
  budget = 100,
  readOnly = false,

  layout = "standard",
  hideFormation = false,
  defaultFormation = "4-4-2",
}: StartingXIProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isSquad15 = layout === "squad15";

  // ---------- standard state ----------
  const [formation, setFormation] = useState<FormationKey>(defaultFormation);
  const [xiSlots, setXiSlots] = useState<Slot[]>(() => buildStandardSlots(defaultFormation));

  const [xiAssign, setXiAssign] = useState<Record<string, Player | null>>(() => {
    const base = buildStandardSlots(defaultFormation);
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
    return map;
  });

  const [benchAssign, setBenchAssign] = useState<Record<string, Player | null>>(() => {
    const map: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (map[s.id] = null));

    // "random default bench" is fine:
    // seed from initialBench first; if missing, fill from leftovers of initial (by position constraints)
    const seedBench = [...initialBench];
    const gk = seedBench.find((p) => p.position === "GK") ?? null;
    const field = seedBench.filter((p) => p.position !== "GK").slice(0, 3);

    map["bench-gk"] = gk;
    map["bench-1"] = field[0] ?? null;
    map["bench-2"] = field[1] ?? null;
    map["bench-3"] = field[2] ?? null;

    return map;
  });

  // ---------- transfers state (squad15) ----------
  const [squadSlots, setSquadSlots] = useState<Slot[]>(() => buildSquad15Slots());
  const [squadAssign, setSquadAssign] = useState<Record<string, Player | null>>(() => {
    const base = buildSquad15Slots();
    const map: Record<string, Player | null> = {};
    base.forEach((s) => (map[s.id] = null));

    const seed = [...initial, ...initialBench];
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

  // shared
  const [openSlot, setOpenSlot] = useState<string | null>(null);

  // ---------- sync from props ----------
  useEffect(() => {
    if (isSquad15) {
      const base = buildSquad15Slots();
      const map: Record<string, Player | null> = {};
      base.forEach((s) => (map[s.id] = null));

      const seed = [...initial, ...initialBench];
      const remaining = [...seed];
      for (const s of base) {
        const idx = remaining.findIndex((p) => p.position === s.position);
        if (idx >= 0) {
          map[s.id] = remaining[idx];
          remaining.splice(idx, 1);
        }
      }

      setSquadSlots(base);
      setSquadAssign(map);
      setOpenSlot(null);
      return;
    }

    // standard: rebuild XI slots for current formation and seed from initial
    const base = buildStandardSlots(formation);
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

    const bmap: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (bmap[s.id] = null));

    // seed bench randomly from initialBench, if present; otherwise leave empties (user can move)
    const seedBench = [...initialBench];
    const gk = seedBench.find((p) => p.position === "GK") ?? null;
    const field = seedBench.filter((p) => p.position !== "GK").slice(0, 3);
    bmap["bench-gk"] = gk;
    bmap["bench-1"] = field[0] ?? null;
    bmap["bench-2"] = field[1] ?? null;
    bmap["bench-3"] = field[2] ?? null;

    setXiSlots(base);
    setXiAssign(map);
    setBenchAssign(bmap);
    setOpenSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, initialBench, isSquad15]);

  // close popups on outside click
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

  // ---------- derived lists ----------
  const xiPlayers = useMemo(() => {
    if (isSquad15) return [];
    return Object.values(xiAssign).filter(Boolean) as Player[];
  }, [xiAssign, isSquad15]);

  const benchPlayers = useMemo(() => {
    if (isSquad15) return [];
    return Object.values(benchAssign).filter(Boolean) as Player[];
  }, [benchAssign, isSquad15]);

  const squadPlayers = useMemo(() => {
    if (!isSquad15) return [];
    return Object.values(squadAssign).filter(Boolean) as Player[];
  }, [squadAssign, isSquad15]);

  const totalValue = useMemo(() => {
    const list = isSquad15 ? squadPlayers : [...xiPlayers, ...benchPlayers];
    return list.reduce((sum, p) => sum + p.value, 0);
  }, [isSquad15, squadPlayers, xiPlayers, benchPlayers]);

  const remainingBudget = useMemo(() => budget - totalValue, [budget, totalValue]);

  // ---------- helpers / validation ----------
  function pickedIdsStandard() {
    return new Set([...xiPlayers, ...benchPlayers].map((p) => p.id));
  }
  function pickedIdsSquad() {
    return new Set(squadPlayers.map((p) => p.id));
  }

  function teamCountStandard(teamId: number) {
    return [...xiPlayers, ...benchPlayers].filter((p) => p.teamId === teamId).length;
  }
  function teamCountSquad(teamId: number) {
    return squadPlayers.filter((p) => p.teamId === teamId).length;
  }

  function canPickStandard(slotPos: Player["position"], p: Player) {
    if (p.position !== slotPos) return false;
    if (pickedIdsStandard().has(p.id)) return false;
    if (teamCountStandard(p.teamId) >= 3) return false;
    if (totalValue + p.value > budget) return false;
    return true;
  }

  function canPickBench(slotKind: "GK" | "FIELD", p: Player) {
    if (pickedIdsStandard().has(p.id)) return false;
    if (teamCountStandard(p.teamId) >= 3) return false;
    if (slotKind === "GK" && p.position !== "GK") return false;
    if (slotKind === "FIELD" && p.position === "GK") return false;
    if (totalValue + p.value > budget) return false;
    return true;
  }

  function canPickSquad(slotPos: Player["position"], p: Player) {
    if (p.position !== slotPos) return false;
    if (pickedIdsSquad().has(p.id)) return false;
    if (teamCountSquad(p.teamId) >= 3) return false;
    if (totalValue + p.value > budget) return false;
    return true;
  }

  function isValidStandard() {
    if (xiPlayers.length !== 11) return false;
    if (benchPlayers.length !== 4) return false;

    const f = FORMATIONS[formation];
    const gk = xiPlayers.filter((p) => p.position === "GK").length;
    const def = xiPlayers.filter((p) => p.position === "DEF").length;
    const mid = xiPlayers.filter((p) => p.position === "MID").length;
    const fwd = xiPlayers.filter((p) => p.position === "FWD").length;

    if (!(gk === 1 && def === f.DEF && mid === f.MID && fwd === f.FWD)) return false;

    const benchGk = benchPlayers.filter((p) => p.position === "GK").length;
    const benchField = benchPlayers.filter((p) => p.position !== "GK").length;
    if (!(benchGk === 1 && benchField === 3)) return false;

    return remainingBudget >= 0;
  }

  function isValidSquad15() {
    if (squadPlayers.length !== 15) return false;
    const gk = squadPlayers.filter((p) => p.position === "GK").length;
    const def = squadPlayers.filter((p) => p.position === "DEF").length;
    const mid = squadPlayers.filter((p) => p.position === "MID").length;
    const fwd = squadPlayers.filter((p) => p.position === "FWD").length;
    return gk === 2 && def === 5 && mid === 5 && fwd === 3 && remainingBudget >= 0;
  }

  // ---------- moving between XI and bench (standard) ----------
  function findEmptyBenchSlotFor(p: Player): string | null {
    if (p.position === "GK") {
      return benchAssign["bench-gk"] ? null : "bench-gk";
    }
    const ids = ["bench-1", "bench-2", "bench-3"] as const;
    for (const id of ids) {
      if (!benchAssign[id]) return id;
    }
    return null;
  }

  function findEmptyXiSlotFor(p: Player): string | null {
    const candidates = xiSlots.filter((s) => s.position === p.position);
    for (const s of candidates) {
      if (!xiAssign[s.id]) return s.id;
    }
    return null;
  }

  function swapOrMoveXiToBench(xiSlotId: string) {
    const p = xiAssign[xiSlotId];
    if (!p) return;

    const emptyBench = findEmptyBenchSlotFor(p);
    if (emptyBench) {
      setXiAssign((prev) => ({ ...prev, [xiSlotId]: null }));
      setBenchAssign((prev) => ({ ...prev, [emptyBench]: p }));
      return;
    }

    // no empty: swap with compatible bench player
    if (p.position === "GK") {
      const benchGk = benchAssign["bench-gk"];
      if (!benchGk) return;
      setXiAssign((prev) => ({ ...prev, [xiSlotId]: benchGk }));
      setBenchAssign((prev) => ({ ...prev, ["bench-gk"]: p }));
      return;
    }

    const ids = ["bench-1", "bench-2", "bench-3"] as const;
    const swapId = ids.find((id) => benchAssign[id] && benchAssign[id]!.position !== "GK");
    if (!swapId) return;
    const bp = benchAssign[swapId]!;
    setXiAssign((prev) => ({ ...prev, [xiSlotId]: bp }));
    setBenchAssign((prev) => ({ ...prev, [swapId]: p }));
  }

  function swapOrMoveBenchToXi(benchSlotId: string) {
    const p = benchAssign[benchSlotId];
    if (!p) return;

    const emptyXi = findEmptyXiSlotFor(p);
    if (emptyXi) {
      setBenchAssign((prev) => ({ ...prev, [benchSlotId]: null }));
      setXiAssign((prev) => ({ ...prev, [emptyXi]: p }));
      return;
    }

    // no empty: swap with same-position XI player
    const candidates = xiSlots.filter((s) => s.position === p.position);
    const swapSlot = candidates.find((s) => !!xiAssign[s.id]);
    if (!swapSlot) return;
    const xp = xiAssign[swapSlot.id]!;
    setBenchAssign((prev) => ({ ...prev, [benchSlotId]: xp }));
    setXiAssign((prev) => ({ ...prev, [swapSlot.id]: p }));
  }

  // ---------- formation switching (standard) ----------
  function applyFormation(next: FormationKey) {
    if (readOnly) return;

    const nextSlots = buildStandardSlots(next);

    // keep all current 15 players, refill deterministically
    const pool = [...xiPlayers, ...benchPlayers];
    const byPos: Record<Player["position"], Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const p of pool) byPos[p.position].push(p);

    const nextXi: Record<string, Player | null> = {};
    nextSlots.forEach((s) => (nextXi[s.id] = null));

    // fill XI: 1 GK then required DEF/MID/FWD
    const f = FORMATIONS[next];
    const pick = (pos: Player["position"]) => byPos[pos].shift() ?? null;

    nextXi["gk-1"] = pick("GK");

    const fillPos = (pos: "DEF" | "MID" | "FWD", count: number) => {
      const slotsForPos = nextSlots.filter((s) => s.position === pos);
      for (let i = 0; i < count; i++) {
        const p = pick(pos);
        if (p) nextXi[slotsForPos[i].id] = p;
      }
    };

    fillPos("DEF", f.DEF);
    fillPos("MID", f.MID);
    fillPos("FWD", f.FWD);

    // rebuild bench: 1 GK + 3 field from leftovers (random is fine)
    const nextBench: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (nextBench[s.id] = null));

    nextBench["bench-gk"] = pick("GK");
    const leftoverField = [...byPos.DEF, ...byPos.MID, ...byPos.FWD];
    nextBench["bench-1"] = leftoverField[0] ?? null;
    nextBench["bench-2"] = leftoverField[1] ?? null;
    nextBench["bench-3"] = leftoverField[2] ?? null;

    setFormation(next);
    setXiSlots(nextSlots);
    setXiAssign(nextXi);
    setBenchAssign(nextBench);
    setOpenSlot(null);
  }

  // ---------- rendering helpers ----------
  const SlotChip = ({
    player,
    onRemove,
    onMove,
  }: {
    player: Player;
    onRemove: () => void;
    onMove?: () => void;
  }) => {
    return (
      <div className="player-chip">
        <div className="player-name">{player.name}</div>
        <div className="player-team">{teamName(teams, player.teamId)}</div>

        {!readOnly && onMove && (
          <button
            type="button"
            className="remove-slot"
            title="Vaihda XI ↔ penkki"
            aria-label="Vaihda XI ↔ penkki"
            onClick={(e) => {
              e.stopPropagation();
              onMove();
            }}
            style={{ right: 28 }}
          >
            ⇄
          </button>
        )}

        {!readOnly && (
          <button
            type="button"
            className="remove-slot"
            title="Poista"
            aria-label="Poista"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  const StandardRow = ({ pos }: { pos: Player["position"] }) => {
    const rowSlots = xiSlots.filter((s) => s.position === pos);

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length}`}>
        {rowSlots.map((s) => {
          const assigned = xiAssign[s.id];
          const isOpen = openSlot === s.id;

          const available = players
            .filter((p) => canPickStandard(pos, p))
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
                <SlotChip
                  player={assigned}
                  onRemove={() => setXiAssign((prev) => ({ ...prev, [s.id]: null }))}
                  onMove={() => swapOrMoveXiToBench(s.id)}
                />
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

  const BenchSection = () => {
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
              .filter((p) => canPickBench(s.kind, p))
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
                  <SlotChip
                    player={assigned}
                    onRemove={() => setBenchAssign((prev) => ({ ...prev, [s.id]: null }))}
                    onMove={() => swapOrMoveBenchToXi(s.id)}
                  />
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

  const Squad15Row = ({ pos }: { pos: Player["position"] }) => {
    const rowSlots = squadSlots.filter((s) => s.position === pos);

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length}`}>
        {rowSlots.map((s) => {
          const assigned = squadAssign[s.id];
          const isOpen = openSlot === s.id;

          const available = players
            .filter((p) => canPickSquad(pos, p))
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
                <SlotChip
                  player={assigned}
                  onRemove={() => setSquadAssign((prev) => ({ ...prev, [s.id]: null }))}
                />
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
                          setSquadAssign((prev) => ({ ...prev, [s.id]: p }));
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

  // ---------- Save ----------
  const saveDisabled = isSquad15 ? !isValidSquad15() : !isValidStandard();

  function handleSave() {
    if (isSquad15) {
      const split = split15ToXIAndBench(squadPlayers);
      if (!split) return;
      onSave(split);
      return;
    }

    // standard: save exact order as selected (crucial)
    onSave({ startingXI: xiPlayers, bench: benchPlayers });
  }

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

          {!isSquad15 && !isValidStandard() && (
            <div className="starting-xi-warning" role="alert">
              Valitse kelvollinen avaus (11) ja penkki (1 MV + 3 kenttä). Budjetti ei saa ylittyä.
            </div>
          )}

          {isSquad15 && !isValidSquad15() && (
            <div className="starting-xi-warning" role="alert">
              Valitse 15 pelaajaa (2 MV, 5 P, 5 KK, 3 H). Budjetti ei saa ylittyä.
            </div>
          )}
        </header>

        <div className="pitch">
          {isSquad15 ? (
            <>
              <Squad15Row pos="GK" />
              <Squad15Row pos="DEF" />
              <Squad15Row pos="MID" />
              <Squad15Row pos="FWD" />
            </>
          ) : (
            <>
              <StandardRow pos="GK" />
              <StandardRow pos="DEF" />
              <StandardRow pos="MID" />
              <StandardRow pos="FWD" />
            </>
          )}
        </div>

        {!isSquad15 && <BenchSection />}

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
}