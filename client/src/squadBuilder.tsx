import React, { useEffect, useMemo, useRef, useState } from "react";

export type Position = "GK" | "DEF" | "MID" | "FWD";

export type Player = {
  id: number;
  name: string;
  position: Position;
  teamId: number;
  value: number;
};

export type Team = { id: number; name: string };

type Slot = { id: string; position: Position; label: string };

function buildSquad15Slots(): Slot[] {
  const slots: Slot[] = [];
  slots.push({ id: "sq-gk-1", position: "GK", label: "MV" });
  slots.push({ id: "sq-gk-2", position: "GK", label: "MV" });
  for (let i = 1; i <= 5; i++) slots.push({ id: `sq-def-${i}`, position: "DEF", label: "P" });
  for (let i = 1; i <= 5; i++) slots.push({ id: `sq-mid-${i}`, position: "MID", label: "KK" });
  for (let i = 1; i <= 3; i++) slots.push({ id: `sq-fwd-${i}`, position: "FWD", label: "H" });
  return slots;
}

function teamName(teams: Team[], id: number) {
  return teams.find((t) => t.id === id)?.name ?? "";
}

export default function SquadBuilder(props: {
  players: Player[];
  teams: Team[];
  initialSquad?: Player[]; // optional seed (15 or less)
  budget: number;
  onSave: (squad: Player[]) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const slots = useMemo(() => buildSquad15Slots(), []);

  const [assign, setAssign] = useState<Record<string, Player | null>>(() => {
    const map: Record<string, Player | null> = {};
    for (const s of slots) map[s.id] = null;
    return map;
  });

  const [openSlot, setOpenSlot] = useState<string | null>(null);

  // seed
  useEffect(() => {
    const map: Record<string, Player | null> = {};
    for (const s of slots) map[s.id] = null;

    const seed = props.initialSquad ?? [];
    const by: Record<Position, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const p of seed) by[p.position].push(p);

    // stable fill
    for (const pos of Object.keys(by) as Position[]) by[pos].sort((a, b) => a.id - b.id);
    for (const s of slots) map[s.id] = by[s.position].shift() ?? null;

    setAssign(map);
    setOpenSlot(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialSquad]);

  // outside click closes
  useEffect(() => {
    function onDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpenSlot(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, []);

  const picked = useMemo(() => Object.values(assign).filter(Boolean) as Player[], [assign]);
  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);
  const totalValue = useMemo(() => picked.reduce((s, p) => s + p.value, 0), [picked]);
  const remainingBudget = props.budget - totalValue;

  function assignTo(slotId: string, p: Player) {
    const current = assign[slotId];

    // prevent duplicates elsewhere, allow replacing current
    if (pickedIds.has(p.id) && current?.id !== p.id) return;

    // replacement-aware budget
    const nextTotal = totalValue - (current?.value ?? 0) + p.value;
    if (nextTotal > props.budget) return;

    setAssign((prev) => ({ ...prev, [slotId]: p }));
    setOpenSlot(null);
  }

  function removeFrom(slotId: string) {
    setAssign((prev) => ({ ...prev, [slotId]: null }));
  }

  const canSave = picked.length === 15 && remainingBudget >= 0;

  return (
    <div ref={rootRef}>
      <div className="app-muted" style={{ marginBottom: 8 }}>
        Budjetti jäljellä: <b>{remainingBudget.toFixed(1)} M</b>
      </div>

      <div className="pitch">
        {(["GK", "DEF", "MID", "FWD"] as const).map((pos) => {
          const row = slots.filter((s) => s.position === pos);
          return (
            <div key={pos} className={`pitch-row pitch-cols-${row.length}`}>
              {row.map((s) => {
                const assigned = assign[s.id];
                const isOpen = openSlot === s.id;

                const available = props.players
                  .filter((p) => p.position === s.position)
                  .filter((p) => !pickedIds.has(p.id) || p.id === assigned?.id)
                  .sort((a, b) => a.name.localeCompare(b.name));

                return (
                  <div
                    key={s.id}
                    className={`slot ${assigned ? "slot-filled" : ""} ${isOpen ? "slot-open" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenSlot(isOpen ? null : s.id)} // always open (replacement)
                  >
                    {assigned ? (
                      <div className="player-chip">
                        <div className="player-name">{assigned.name}</div>
                        <div className="player-team">{teamName(props.teams, assigned.teamId)}</div>
                        <button
                          type="button"
                          className="remove-slot"
                          title="Poista"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFrom(s.id);
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ) : (
                      <div className="slot-empty">{s.label}</div>
                    )}

                    {isOpen && (
                      <div className="slot-pop" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
                        <div className="slot-pop-title">Valitse pelaaja</div>
                        <div className="slot-pop-list">
                          {available.map((p) => (
                            <button
                              key={p.id}
                              type="button"
                              className="slot-pop-btn"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                assignTo(s.id, p);
                              }}
                            >
                              <span className="slot-pop-name">{p.name}</span>
                              <span className="slot-pop-team">{teamName(props.teams, p.teamId)}</span>
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
        })}
      </div>

      <div className="starting-xi-controls" style={{ marginTop: 12 }}>
        <button className="xi-save" disabled={!canSave} onClick={() => props.onSave(picked)}>
          Tallenna
        </button>
      </div>
    </div>
  );
}