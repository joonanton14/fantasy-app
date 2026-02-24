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

const FORMATIONS: Record<FormationKey, { DEF: number; MID: number; FWD: number }> = {
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

// Transfers view: 15 slots only, no bench UI
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

export type SavePayload = { startingXI: Player[]; bench: Player[]; formation?: FormationKey };

type SwapSource =
  | { area: "xi"; slotId: string }
  | { area: "bench"; slotId: string }
  | null;

interface Props {
  players: Player[];
  teams: Team[];
  initial?: Player[]; // XI players (standard)
  initialBench?: Player[]; // bench players (standard)
  onSave: (payload: SavePayload) => void;
  budget?: number;
  readOnly?: boolean;

  // layout modes
  layout?: "standard" | "squad15"; // standard = XI+bench+formation, squad15 = transfers view
  hideFormation?: boolean;

  // persisted formation
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

  // formation only matters in standard layout
  const [formation, setFormation] = useState<FormationKey>(initialFormation);

  const [xiSlots, setXiSlots] = useState<Slot[]>(() =>
    isSquad15 ? buildSquad15Slots() : buildStandardSlots(initialFormation)
  );

  const [xiAssign, setXiAssign] = useState<Record<string, Player | null>>(() => {
    const base = isSquad15 ? buildSquad15Slots() : buildStandardSlots(initialFormation);
    const map: Record<string, Player | null> = {};
    base.forEach((s) => (map[s.id] = null));

    // standard: seed from initial only
    // squad15: seed from initial + bench
    const seed = isSquad15 ? uniqById([...initial, ...initialBench]) : [...initial];
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

  // ✅ NEW: swap flow
  const [swapSource, setSwapSource] = useState<SwapSource>(null);

  // ---- sync from parent (refresh/tab change) ----
  useEffect(() => {
    if (isSquad15) {
      const base = buildSquad15Slots();
      setXiSlots(base);

      const map: Record<string, Player | null> = {};
      base.forEach((s) => (map[s.id] = null));

      const seed = uniqById([...initial, ...initialBench]);
      const remaining = [...seed];

      for (const s of base) {
        const idx = remaining.findIndex((p) => p.position === s.position);
        if (idx >= 0) {
          map[s.id] = remaining[idx];
          remaining.splice(idx, 1);
        }
      }

      setXiAssign(map);
      setBenchAssign((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => (next[k] = null));
        return next;
      });

      setOpenSlot(null);
      setSwapSource(null);
      return;
    }

    // standard
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
    setSwapSource(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, initialBench, initialFormation, isSquad15]);

  // close popups if click outside
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

  const xiPlayers = useMemo(() => Object.values(xiAssign).filter(Boolean) as Player[], [xiAssign]);
  const benchPlayers = useMemo(() => {
    if (isSquad15) return [];
    return (Object.values(benchAssign).filter(Boolean) as Player[]) ?? [];
  }, [benchAssign, isSquad15]);

  const pickedIds = useMemo(() => new Set<number>([...xiPlayers, ...benchPlayers].map((p) => p.id)), [xiPlayers, benchPlayers]);

  const totalValue = useMemo(() => {
    return [...xiPlayers, ...benchPlayers].reduce((sum, p) => sum + p.value, 0);
  }, [xiPlayers, benchPlayers]);

  const remainingBudget = useMemo(() => budget - totalValue, [budget, totalValue]);

  // ---- constraints (standard) ----
  const f = FORMATIONS[formation];
  const counts = useMemo(() => {
    const c: Record<Position, number> = { GK: 0, DEF: 0, MID: 0, FWD: 0 };
    for (const p of xiPlayers) c[p.position] += 1;
    return c;
  }, [xiPlayers]);

  const LIMITS = useMemo(() => {
    return {
      GK: { min: 1, max: 1 },
      DEF: { min: f.DEF, max: f.DEF },
      MID: { min: f.MID, max: f.MID },
      FWD: { min: f.FWD, max: f.FWD },
    };
  }, [f.DEF, f.MID, f.FWD]);

  function isValidXI() {
    if (isSquad15) {
      // transfers view: must have 15 filled
      return xiPlayers.length === 15;
    }
    if (xiPlayers.length !== 11) return false;
    return (
      counts.GK === LIMITS.GK.max &&
      counts.DEF === LIMITS.DEF.max &&
      counts.MID === LIMITS.MID.max &&
      counts.FWD === LIMITS.FWD.max
    );
  }

  function isValidBench() {
    if (isSquad15) return true;
    if (benchPlayers.length !== 4) return false;
    const gkCount = benchPlayers.filter((p) => p.position === "GK").length;
    const fieldCount = benchPlayers.filter((p) => p.position !== "GK").length;
    return gkCount === 1 && fieldCount === 3;
  }

  // --- formation change (standard only) ---
  function applyFormation(next: FormationKey) {
    if (readOnly) return;
    if (isSquad15) return;

    const nextSlots = buildStandardSlots(next);
    const pool = [...xiPlayers, ...benchPlayers];

    const byPos: Record<Position, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const p of pool) byPos[p.position].push(p);

    const nextMap: Record<string, Player | null> = {};
    nextSlots.forEach((s) => (nextMap[s.id] = null));

    // GK
    nextMap["gk-1"] = byPos.GK.shift() ?? null;

    const req = FORMATIONS[next];
    const fill = (pos: "DEF" | "MID" | "FWD", count: number) => {
      const slotsForPos = nextSlots.filter((s) => s.position === pos);
      for (let i = 0; i < count; i++) {
        const p = byPos[pos].shift() ?? null;
        if (p) nextMap[slotsForPos[i].id] = p;
      }
    };
    fill("DEF", req.DEF);
    fill("MID", req.MID);
    fill("FWD", req.FWD);

    // rebuild bench (random is fine)
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
    setSwapSource(null);
  }

  // ---- assign/remove helpers ----
  function assignToXi(slotId: string, p: Player) {
    if (readOnly) return;
    if (pickedIds.has(p.id)) return;
    if (totalValue + p.value > budget) return;
    setXiAssign((prev) => ({ ...prev, [slotId]: p }));
    setOpenSlot(null);
  }

  function removeFromXi(slotId: string) {
    if (readOnly) return;
    setXiAssign((prev) => ({ ...prev, [slotId]: null }));
    setOpenSlot(null);
    setSwapSource(null);
  }

  function assignToBench(slotId: string, kind: "GK" | "FIELD", p: Player) {
    if (readOnly) return;
    if (isSquad15) return;
    if (pickedIds.has(p.id)) return;
    if (totalValue + p.value > budget) return;
    if (kind === "GK" && p.position !== "GK") return;
    if (kind === "FIELD" && p.position === "GK") return;
    setBenchAssign((prev) => ({ ...prev, [slotId]: p }));
    setOpenSlot(null);
  }

  function removeFromBench(slotId: string) {
    if (readOnly) return;
    if (isSquad15) return;
    setBenchAssign((prev) => ({ ...prev, [slotId]: null }));
    setOpenSlot(null);
    setSwapSource(null);
  }

  // ---- swap logic (standard only) ----
  function beginSwap(area: "xi" | "bench", slotId: string) {
    if (readOnly) return;
    if (isSquad15) return;

    // only if slot has a player
    const p = area === "xi" ? xiAssign[slotId] : benchAssign[slotId];
    if (!p) return;

    setOpenSlot(null);
    setSwapSource({ area, slotId });
  }

  function trySwap(targetArea: "xi" | "bench", targetSlotId: string) {
    if (readOnly) return;
    if (isSquad15) return;
    if (!swapSource) return;

    // must be different area (bench <-> xi)
    if (swapSource.area === targetArea) return;

    const srcP = swapSource.area === "xi" ? xiAssign[swapSource.slotId] : benchAssign[swapSource.slotId];
    const dstP = targetArea === "xi" ? xiAssign[targetSlotId] : benchAssign[targetSlotId];
    if (!srcP || !dstP) return;

    // constraints:
    // - bench-gk must hold GK
    // - bench field slots must not hold GK
    // - xi slots are position-specific (must match slot position)
    const xiSlot = xiSlots.find((s) => s.id === (targetArea === "xi" ? targetSlotId : swapSource.slotId));
    const benchSlot = BENCH_SLOTS.find((s) => s.id === (targetArea === "bench" ? targetSlotId : swapSource.slotId));

    if (!xiSlot || !benchSlot) return;

    const xiIncoming = targetArea === "xi" ? srcP : dstP;
    const benchIncoming = targetArea === "bench" ? srcP : dstP;

    // xi slot position must match xiIncoming
    if (xiIncoming.position !== xiSlot.position) return;

    // bench slot kind must match benchIncoming
    if (benchSlot.kind === "GK" && benchIncoming.position !== "GK") return;
    if (benchSlot.kind === "FIELD" && benchIncoming.position === "GK") return;

    // perform swap
    if (targetArea === "xi") {
      // src from bench -> xi, dst from xi -> bench
      setXiAssign((prev) => ({ ...prev, [targetSlotId]: srcP }));
      setBenchAssign((prev) => ({ ...prev, [swapSource.slotId]: dstP }));
    } else {
      // src from xi -> bench, dst from bench -> xi
      setBenchAssign((prev) => ({ ...prev, [targetSlotId]: srcP }));
      setXiAssign((prev) => ({ ...prev, [swapSource.slotId]: dstP }));
    }

    setSwapSource(null);
    setOpenSlot(null);
  }

  // ---- save (standard and squad15) ----
  function buildSavePayload(): SavePayload {
    if (!isSquad15) {
      return { startingXI: xiPlayers, bench: benchPlayers, formation };
    }

    // squad15: convert 15 chosen into {xi:11, bench:4} so server validation passes
    // Rule:
    // - XI gets 1 GK + (first 10 outfield by slot order)
    // - Bench gets 1 GK + 3 outfield
    const orderedSlots = xiSlots; // squad15 slots already in correct positional grouping order
    const picked: Player[] = orderedSlots.map((s) => xiAssign[s.id]).filter(Boolean) as Player[];

    const gks = picked.filter((p) => p.position === "GK");
    const out = picked.filter((p) => p.position !== "GK");

    const xiGK = gks[0] ?? null;
    const benchGK = gks[1] ?? null;

    const xiOut = out.slice(0, 10);
    const benchOut = out.slice(10, 13);

    const startingXI: Player[] = [];
    if (xiGK) startingXI.push(xiGK);
    startingXI.push(...xiOut);

    const bench: Player[] = [];
    if (benchGK) bench.push(benchGK);
    bench.push(...benchOut);

    return { startingXI, bench };
  }

  const saveDisabled = useMemo(() => {
    if (remainingBudget < 0) return true;
    if (!isValidXI()) return true;
    if (!isValidBench()) return true;
    return false;
  }, [remainingBudget, isSquad15, xiPlayers.length, benchPlayers.length, formation, counts, LIMITS]);

  const Row = ({ position }: { position: Position }) => {
    const rowSlots = xiSlots.filter((s) => s.position === position);

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length}`}>
        {rowSlots.map((s) => {
          const assigned = xiAssign[s.id];
          const isOpen = openSlot === s.id;
          const isSwapSelected = swapSource?.area === "xi" && swapSource.slotId === s.id;

          const available = players
            .filter((p) => p.position === s.position && !pickedIds.has(p.id))
            .map((p) => ({ ...p, teamName: teamName(teams, p.teamId) }))
            .sort((a, b) => a.name.localeCompare(b.name));

          const clickable = !readOnly;

          return (
            <div
              key={s.id}
              className={`slot ${assigned ? "slot-filled" : ""} ${isOpen ? "slot-open" : ""} ${
                isSwapSelected ? "slot-swap-selected" : ""
              }`}
              onClick={() => {
                if (!clickable) return;

                // if swap is armed, try swap into this XI slot
                if (swapSource && swapSource.area === "bench" && assigned) {
                  trySwap("xi", s.id);
                  return;
                }

                // arm swap from XI
                if (!isSquad15 && assigned) {
                  // short click: open picker; long flow: if swap already set do nothing
                  // we’ll use: Shift-like behavior not available; so we arm swap on second click
                  // To keep it simple: if swapSource exists -> clear, else set swapSource.
                  beginSwap("xi", s.id);
                  return;
                }

                // otherwise open picker for empty slot
                if (!assigned) setOpenSlot(isOpen ? null : s.id);
              }}
              role="button"
              tabIndex={0}
              title={
                isSquad15
                  ? undefined
                  : assigned
                  ? "Klikkaa vaihtaaksesi (valitse penkiltä pelaaja ja klikkaa tätä)"
                  : "Klikkaa valitaksesi pelaaja"
              }
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
                        removeFromXi(s.id);
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
                      <button key={p.id} type="button" className="slot-pop-btn" onClick={() => assignToXi(s.id, p)}>
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
            const isSwapSelected = swapSource?.area === "bench" && swapSource.slotId === s.id;

            const available = players
              .filter((p) => {
                if (pickedIds.has(p.id)) return false;
                if (s.kind === "GK") return p.position === "GK";
                return p.position !== "GK";
              })
              .map((p) => ({ ...p, teamName: teamName(teams, p.teamId) }))
              .sort((a, b) => a.name.localeCompare(b.name));

            return (
              <div
                key={s.id}
                className={`slot ${assigned ? "slot-filled" : ""} ${isOpen ? "slot-open" : ""} ${
                  isSwapSelected ? "slot-swap-selected" : ""
                }`}
                onClick={() => {
                  if (readOnly) return;

                  // if swap is armed from XI, swap into this bench slot (needs a player here)
                  if (swapSource && swapSource.area === "xi" && assigned) {
                    trySwap("bench", s.id);
                    return;
                  }

                  // arm swap from bench
                  if (assigned) {
                    beginSwap("bench", s.id);
                    return;
                  }

                  // open picker for empty slot
                  setOpenSlot(isOpen ? null : s.id);
                }}
                role="button"
                tabIndex={0}
                title={assigned ? "Klikkaa vaihtaaksesi (valitse kentältä pelaaja ja klikkaa tätä)" : "Klikkaa valitaksesi"}
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
                          removeFromBench(s.id);
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
                          onClick={() => assignToBench(s.id, s.kind, p)}
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
            Valitse 1 maalivahti ja 3 kenttäpelaajaa penkille.
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="starting-xi-root" ref={rootRef}>
      <div className="starting-xi-card">
        <header className="starting-xi-header">
          <h2>{isSquad15 ? "Vaihdot (15 pelaajaa)" : "Avauskokoonpano"}</h2>

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
            </div>
          )}

          {!isValidXI() && (
            <div className="starting-xi-warning" role="alert">
              {isSquad15 ? "Valitse 15 pelaajaa." : "Avaus ei ole kelvollinen."}
            </div>
          )}

          {swapSource && !isSquad15 && (
            <div className="starting-xi-warning" role="alert" style={{ opacity: 0.9 }}>
              Vaihto valittu: {swapSource.area === "xi" ? "Kentältä" : "Penkiltä"} — klikkaa vastapuolen pelaajaa vaihtaaksesi.
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
            <button type="button" className="xi-save" onClick={() => onSave(buildSavePayload())} disabled={saveDisabled}>
              Tallenna
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// ✅ Keep both exports so your imports won’t break again
export default StartingXI;