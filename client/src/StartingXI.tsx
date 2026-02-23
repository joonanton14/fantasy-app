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

// ✅ NEW: fixed squad slots for Transfers: 2/5/5/3
function buildSquadSlots(): Slot[] {
  const slots: Slot[] = [];
  slots.push({ id: "sq-gk-1", position: "GK" });
  slots.push({ id: "sq-gk-2", position: "GK" });
  for (let i = 1; i <= 5; i++) slots.push({ id: `sq-def-${i}`, position: "DEF" });
  for (let i = 1; i <= 5; i++) slots.push({ id: `sq-mid-${i}`, position: "MID" });
  for (let i = 1; i <= 3; i++) slots.push({ id: `sq-fwd-${i}`, position: "FWD" });
  return slots;
}

function inferFormationFromXI(xi: Player[]): FormationKey | null {
  const gk = xi.filter((p) => p.position === "GK").length;
  const def = xi.filter((p) => p.position === "DEF").length;
  const mid = xi.filter((p) => p.position === "MID").length;
  const fwd = xi.filter((p) => p.position === "FWD").length;
  if (gk !== 1) return null;

  const hit = (Object.keys(FORMATIONS) as FormationKey[]).find((k) => {
    const f = FORMATIONS[k];
    return f.DEF === def && f.MID === mid && f.FWD === fwd;
  });

  return hit ?? null;
}

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
  hideFormation?: boolean;
  fixedFormation?: FormationKey;

  // ✅ NEW:
  layout?: "standard" | "squad15";
}

function teamNameOf(teams: Team[], teamId: number) {
  return teams.find((t) => t.id === teamId)?.name ?? "";
}

function totalValueOf(list: Player[]) {
  return list.reduce((sum, p) => sum + p.value, 0);
}

// ✅ NEW: split 15-player squad into startingXI (11) + bench (4)
// Default policy: startingXI = 1 GK, 3 DEF, 4 MID, 3 FWD  (3-4-3)
// Bench = remaining 4 (1 GK, 2 DEF, 1 MID)
function splitSquadToXIAndBench(squad: Player[]): { startingXI: Player[]; bench: Player[]; ok: boolean } {
  const gk = squad.filter((p) => p.position === "GK");
  const def = squad.filter((p) => p.position === "DEF");
  const mid = squad.filter((p) => p.position === "MID");
  const fwd = squad.filter((p) => p.position === "FWD");

  if (gk.length !== 2 || def.length !== 5 || mid.length !== 5 || fwd.length !== 3) {
    return { startingXI: [], bench: [], ok: false };
  }

  const startingXI: Player[] = [
    gk[0], // starter GK
    ...def.slice(0, 3),
    ...mid.slice(0, 4),
    ...fwd.slice(0, 3),
  ];

  const bench: Player[] = [
    gk[1], // bench GK
    ...def.slice(3, 5), // 2 defs
    ...mid.slice(4, 5), // 1 mid
  ];

  return { startingXI, bench, ok: true };
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
  hideFormation,
  fixedFormation,

  layout = "standard",
}: StartingXIProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const isTransfers = mode === "transfers";
  const isSquad15 = layout === "squad15";

  const showFormation = hideFormation === true ? false : !isTransfers; // transfers hides formation by default

  // In squad15 layout, we ignore formation + ignore bench UI
  const inferred = inferFormationFromXI(initial);
  const initialFormation: FormationKey = isTransfers
    ? (fixedFormation ?? inferred ?? "4-4-2")
    : (inferred ?? "4-4-2");

  const [formation, setFormation] = useState<FormationKey>(initialFormation);

  const [slots, setSlots] = useState<Slot[]>(() => {
    return isSquad15 ? buildSquadSlots() : buildSlots(initialFormation);
  });

  // One assignment map drives BOTH layouts:
  const [slotAssignments, setSlotAssignments] = useState<Record<string, Player | null>>(() => {
    const baseSlots = isSquad15 ? buildSquadSlots() : buildSlots(initialFormation);
    const map: Record<string, Player | null> = {};
    baseSlots.forEach((s) => (map[s.id] = null));

    // Seed from initial + initialBench (15 total possible)
    const seed = [...initial, ...initialBench];

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

  // Sync when parent updates
  useEffect(() => {
    if (isSquad15) {
      const baseSlots = buildSquadSlots();
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

    setFormation(effectiveFormation);
    setSlots(baseSlots);
    setSlotAssignments(map);
    setOpenSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial, initialBench, isTransfers, fixedFormation, isSquad15]);

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

  const totalValue = useMemo(() => totalValueOf(picked), [picked]);
  const remainingBudget = useMemo(() => budget - totalValue, [budget, totalValue]);

  function isPickedAnywhere(id: number) {
    return picked.some((p) => p.id === id);
  }

  function teamCountAll(teamId: number) {
    return picked.filter((p) => p.teamId === teamId).length;
  }

  function canAssignToSlot(slotPos: Player["position"], p: Player) {
    if (p.position !== slotPos) return false;
    if (isPickedAnywhere(p.id)) return false;
    if (teamCountAll(p.teamId) >= 3) return false;
    if (totalValue + p.value > budget) return false;
    return true;
  }

  function assignToSlot(slotId: string, slotPos: Player["position"], p: Player) {
    if (readOnly) return;
    if (!canAssignToSlot(slotPos, p)) return;
    setSlotAssignments((prev) => ({ ...prev, [slotId]: p }));
    setOpenSlot(null);
  }

  function removeFromSlot(slotId: string) {
    if (readOnly) return;
    setSlotAssignments((prev) => ({ ...prev, [slotId]: null }));
  }

  // builder formation change (only for standard layout)
  function applyFormation(next: FormationKey) {
    if (readOnly) return;
    if (isTransfers) return;
    if (isSquad15) return;

    const nextSlots = buildSlots(next);
    const pool = Object.values(slotAssignments).filter(Boolean) as Player[];

    const poolByPos: Record<Player["position"], Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const p of pool) poolByPos[p.position].push(p);

    const nextMap: Record<string, Player | null> = {};
    nextSlots.forEach((s) => (nextMap[s.id] = null));

    const gkPick = poolByPos.GK.shift() ?? null;
    if (gkPick) nextMap["gk-1"] = gkPick;

    const req = FORMATIONS[next];
    const fillPos = (pos: "DEF" | "MID" | "FWD", count: number) => {
      const slotsForPos = nextSlots.filter((s) => s.position === pos);
      for (let i = 0; i < count; i++) {
        const pp = poolByPos[pos].shift() ?? null;
        if (pp) nextMap[slotsForPos[i].id] = pp;
      }
    };

    fillPos("DEF", req.DEF);
    fillPos("MID", req.MID);
    fillPos("FWD", req.FWD);

    setFormation(next);
    setSlots(nextSlots);
    setSlotAssignments(nextMap);
    setOpenSlot(null);
  }

  // ✅ validation
  const saveDisabled = useMemo(() => {
    if (remainingBudget < 0) return true;

    if (isSquad15) {
      const gk = picked.filter((p) => p.position === "GK").length;
      const def = picked.filter((p) => p.position === "DEF").length;
      const mid = picked.filter((p) => p.position === "MID").length;
      const fwd = picked.filter((p) => p.position === "FWD").length;
      return !(picked.length === 15 && gk === 2 && def === 5 && mid === 5 && fwd === 3);
    }

    // standard XI must have 11 (with formation)
    const f = FORMATIONS[formation];
    const gk = picked.filter((p) => p.position === "GK").length;
    const def = picked.filter((p) => p.position === "DEF").length;
    const mid = picked.filter((p) => p.position === "MID").length;
    const fwd = picked.filter((p) => p.position === "FWD").length;
    return !(picked.length === 11 && gk === 1 && def === f.DEF && mid === f.MID && fwd === f.FWD);
  }, [picked, remainingBudget, isSquad15, formation]);

  const Row = ({ position, label, slotsCount }: { position: Player["position"]; label: string; slotsCount: number }) => {
    const rowSlots = slots.filter((s) => s.position === position).slice(0, slotsCount);

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length}`}>
        {rowSlots.map((s) => {
          const assigned = slotAssignments[s.id];
          const isOpen = openSlot === s.id;

          const available = players
            .filter((p) => canAssignToSlot(position, p))
            .map((p) => ({ ...p, teamName: teamNameOf(teams, p.teamId) }))
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
                  <div className="player-team">{teamNameOf(teams, assigned.teamId)}</div>
                  {!readOnly && (
                    <button
                      type="button"
                      className="remove-slot"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFromSlot(s.id);
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
                      <button key={p.id} type="button" className="slot-pop-btn" onClick={() => assignToSlot(s.id, position, p)}>
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
      const { startingXI, bench, ok } = splitSquadToXIAndBench(picked);
      if (!ok) return;
      onSave({ startingXI, bench });
      return;
    }

    // standard mode: only XI stored here (bench handled elsewhere in your old version)
    // For standard, we save exactly what is on slots as startingXI, and keep initialBench as bench (unchanged)
    // If you want standard editor to also edit bench here, tell me and I’ll merge logic back in.
    onSave({ startingXI: picked, bench: initialBench });
  }

  return (
    <div className="starting-xi-root" ref={rootRef}>
      <div className="starting-xi-card">
        <header className="starting-xi-header">
          <h2>{isSquad15 ? "Joukkue (15)" : "Avauskokoonpano"}</h2>

          <div className="starting-xi-meta">
            {showFormation && !isSquad15 && (
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

          {isSquad15 ? (
            picked.length !== 15 && <div className="starting-xi-warning">Valitse 15 pelaajaa (2 MV, 5 P, 5 KK, 3 H).</div>
          ) : (
            picked.length !== 11 && <div className="starting-xi-warning">Valitse 11 pelaajaa.</div>
          )}
        </header>

        <div className="pitch">
          {isSquad15 ? (
            <>
              <Row position="GK" label="MV" slotsCount={2} />
              <Row position="DEF" label="P" slotsCount={5} />
              <Row position="MID" label="KK" slotsCount={5} />
              <Row position="FWD" label="H" slotsCount={3} />
            </>
          ) : (
            <>
              <Row position="GK" label="MV" slotsCount={1} />
              <Row position="DEF" label="P" slotsCount={slots.filter((s) => s.position === "DEF").length} />
              <Row position="MID" label="KK" slotsCount={slots.filter((s) => s.position === "MID").length} />
              <Row position="FWD" label="H" slotsCount={slots.filter((s) => s.position === "FWD").length} />
            </>
          )}
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