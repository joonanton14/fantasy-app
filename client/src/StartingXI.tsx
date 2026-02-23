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

// For builder (standard) only
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

function buildStandardSlots(formation: FormationKey): Slot[] {
  const f = FORMATIONS[formation];
  const slots: Slot[] = [{ id: "gk-1", position: "GK", label: "MV" }];
  for (let i = 1; i <= f.DEF; i++) slots.push({ id: `def-${i}`, position: "DEF", label: "P" });
  for (let i = 1; i <= f.MID; i++) slots.push({ id: `mid-${i}`, position: "MID", label: "KK" });
  for (let i = 1; i <= f.FWD; i++) slots.push({ id: `fwd-${i}`, position: "FWD", label: "H" });
  return slots;
}

// ✅ Transfers page layout: 2 GK / 5 DEF / 5 MID / 3 FWD
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

function split15ToXIAndBench(squad: Player[]): SavePayload | null {
  // Expect exactly: 2 GK, 5 DEF, 5 MID, 3 FWD
  const gk = squad.filter((p) => p.position === "GK");
  const def = squad.filter((p) => p.position === "DEF");
  const mid = squad.filter((p) => p.position === "MID");
  const fwd = squad.filter((p) => p.position === "FWD");

  if (gk.length !== 2 || def.length !== 5 || mid.length !== 5 || fwd.length !== 3) return null;

  // ✅ "Random order is ok" but must be valid:
  // StartingXI = 1 GK + 10 field (take first of each group deterministically)
  // Bench     = 1 GK + 3 field (rest)
  const startingXI: Player[] = [
    gk[0],
    ...def.slice(0, 4), // 4 DEF
    ...mid.slice(0, 4), // 4 MID
    ...fwd.slice(0, 2), // 2 FWD  => 1 + 4 + 4 + 2 = 11
  ];

  const bench: Player[] = [
    gk[1], // bench GK
    def[4], // last DEF
    mid[4], // last MID
    fwd[2], // last FWD => 1 GK + 3 field
  ];

  return { startingXI, bench };
}

export interface StartingXIProps {
  players: Player[];
  teams: Team[];
  initial?: Player[]; // startingXI (11) when standard; in squad15 we seed with initial+initialBench
  initialBench?: Player[];
  onSave: (payload: SavePayload) => void;
  budget?: number;
  readOnly?: boolean;

  // builder uses standard, transfers uses squad15
  layout?: "standard" | "squad15";

  // standard-only
  formation?: FormationKey;
  hideFormation?: boolean;
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
  formation: formationProp = "4-4-2",
  hideFormation = false,
}: StartingXIProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const isSquad15 = layout === "squad15";

  const [formation, setFormation] = useState<FormationKey>(formationProp);

  const [slots, setSlots] = useState<Slot[]>(() => (isSquad15 ? buildSquad15Slots() : buildStandardSlots(formationProp)));

  const [slotAssignments, setSlotAssignments] = useState<Record<string, Player | null>>(() => {
    const baseSlots = isSquad15 ? buildSquad15Slots() : buildStandardSlots(formationProp);
    const map: Record<string, Player | null> = {};
    baseSlots.forEach((s) => (map[s.id] = null));

    // Seed:
    // - standard: seed from initial (11)
    // - squad15: seed from initial + initialBench (15)
    const seed = isSquad15 ? [...initial, ...initialBench] : [...initial];
    const remaining = [...seed];

    for (const s of baseSlots) {
      const idx = remaining.findIndex((p) => p.position === s.position);
      if (idx >= 0) {
        map[s.id] = remaining[idx];
        remaining.splice(idx, 1);
      }
    }

    return map;
  });

  const [openSlot, setOpenSlot] = useState<string | null>(null);

  // Sync on props change
  useEffect(() => {
    if (isSquad15) {
      const baseSlots = buildSquad15Slots();
      const map: Record<string, Player | null> = {};
      baseSlots.forEach((s) => (map[s.id] = null));

      const seed = [...initial, ...initialBench];
      const remaining = [...seed];

      for (const s of baseSlots) {
        const idx = remaining.findIndex((p) => p.position === s.position);
        if (idx >= 0) {
          map[s.id] = remaining[idx];
          remaining.splice(idx, 1);
        }
      }

      setSlots(baseSlots);
      setSlotAssignments(map);
      setOpenSlot(null);
      return;
    }

    // standard
    const baseSlots = buildStandardSlots(formation);
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

    setSlots(baseSlots);
    setSlotAssignments(map);
    setOpenSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, initialBench, isSquad15]);

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

  const picked = useMemo(() => Object.values(slotAssignments).filter(Boolean) as Player[], [slotAssignments]);

  const totalValue = useMemo(() => picked.reduce((sum, p) => sum + p.value, 0), [picked]);
  const remainingBudget = useMemo(() => budget - totalValue, [budget, totalValue]);

  function isPickedAnywhere(id: number) {
    return picked.some((p) => p.id === id);
  }

  function teamCount(teamId: number) {
    return picked.filter((p) => p.teamId === teamId).length;
  }

  function canAssign(slotPos: Player["position"], p: Player) {
    if (p.position !== slotPos) return false;
    if (isPickedAnywhere(p.id)) return false;
    if (teamCount(p.teamId) >= 3) return false;
    if (totalValue + p.value > budget) return false;
    return true;
  }

  function assign(slotId: string, slotPos: Player["position"], p: Player) {
    if (readOnly) return;
    if (!canAssign(slotPos, p)) return;
    setSlotAssignments((prev) => ({ ...prev, [slotId]: p }));
    setOpenSlot(null);
  }

  function remove(slotId: string) {
    if (readOnly) return;
    setSlotAssignments((prev) => ({ ...prev, [slotId]: null }));
  }

  // Builder formation change (only standard)
  function applyFormation(next: FormationKey) {
    if (readOnly) return;
    if (isSquad15) return;

    const nextSlots = buildStandardSlots(next);
    const pool = Object.values(slotAssignments).filter(Boolean) as Player[];

    const byPos: Record<Player["position"], Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const p of pool) byPos[p.position].push(p);

    const map: Record<string, Player | null> = {};
    nextSlots.forEach((s) => (map[s.id] = null));

    // fill deterministically
    for (const s of nextSlots) {
      const p = byPos[s.position].shift() ?? null;
      if (p) map[s.id] = p;
    }

    setFormation(next);
    setSlots(nextSlots);
    setSlotAssignments(map);
    setOpenSlot(null);
  }

  const saveDisabled = useMemo(() => {
    if (remainingBudget < 0) return true;

    if (isSquad15) {
      const gk = picked.filter((p) => p.position === "GK").length;
      const def = picked.filter((p) => p.position === "DEF").length;
      const mid = picked.filter((p) => p.position === "MID").length;
      const fwd = picked.filter((p) => p.position === "FWD").length;
      return !(picked.length === 15 && gk === 2 && def === 5 && mid === 5 && fwd === 3);
    }

    // standard: must be 11 total
    return picked.length !== 11;
  }, [picked, remainingBudget, isSquad15]);

  const Row = ({ position, title }: { position: Player["position"]; title: string }) => {
    const rowSlots = slots.filter((s) => s.position === position);

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length}`}>
        {rowSlots.map((s) => {
          const assigned = slotAssignments[s.id];
          const isOpen = openSlot === s.id;

          const available = players
            .filter((p) => canAssign(position, p))
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
                        remove(s.id);
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
                      <button key={p.id} type="button" className="slot-pop-btn" onClick={() => assign(s.id, position, p)}>
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

  function handleSave() {
    if (isSquad15) {
      const split = split15ToXIAndBench(picked);
      if (!split) return;
      onSave(split);
      return;
    }

    // standard: keep existing bench unchanged (user decides XI in this view)
    onSave({ startingXI: picked, bench: initialBench });
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
                <select className="formation-select" value={formation} onChange={(e) => applyFormation(e.target.value as FormationKey)} disabled={readOnly}>
                  {(Object.keys(FORMATIONS) as FormationKey[]).map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {isSquad15 ? (
            picked.length !== 15 && <div className="starting-xi-warning">Valitse 15 pelaajaa (2 MV, 5 P, 5 KK, 3 H).</div>
          ) : (
            picked.length !== 11 && <div className="starting-xi-warning">Valitse 11 pelaajaa.</div>
          )}
        </header>

        <div className="pitch">
          <Row position="GK" title="MV" />
          <Row position="DEF" title="P" />
          <Row position="MID" title="KK" />
          <Row position="FWD" title="H" />
        </div>

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