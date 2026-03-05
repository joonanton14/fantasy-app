import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadSavedTeam } from "./userTeam";

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
  initialSquad?: Player[];
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

  // ✅ NEW: if parent didn't pass initialSquad, we can auto-load from /user-team
  const [autoInitialSquad, setAutoInitialSquad] = useState<Player[] | null>(null);
  const [autoLoaded, setAutoLoaded] = useState(false);

  // Bottom-sheet picker state
  const [picker, setPicker] = useState<{ slotId: string; pos: Position } | null>(null);
  const [q, setQ] = useState("");

  // Undo remove
  const [lastRemoved, setLastRemoved] = useState<{ slotId: string; player: Player } | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  // ✅ NEW: load saved team from API once on mount (cookie session decides who the user is)
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        // only auto-load if parent didn't give an initialSquad
        if (props.initialSquad && props.initialSquad.length) {
          setAutoLoaded(true);
          return;
        }

        const saved = await loadSavedTeam(); // GET /user-team (credentials included via apiCall)
        if (cancelled) return;

        const ids = saved?.squadIds;
        if (!ids || ids.length !== 15) {
          setAutoLoaded(true);
          return;
        }

        // Map saved ids -> Player objects using props.players
        const byId = new Map(props.players.map((p) => [p.id, p] as const));
        const mapped = ids.map((id) => byId.get(id)).filter(Boolean) as Player[];

        // only accept if we can resolve all 15
        if (mapped.length === 15) {
          setAutoInitialSquad(mapped);
        }

        setAutoLoaded(true);
      } catch {
        if (!cancelled) setAutoLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
    // only rerun if the player list changes (e.g. after initial data fetch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.players]);

  const effectiveInitialSquad = props.initialSquad ?? autoInitialSquad ?? [];

  useEffect(() => {
    // If parent didn't pass initialSquad and we haven't tried/finished autoload yet, wait.
    if (!props.initialSquad && !autoLoaded) return;

    const map: Record<string, Player | null> = {};
    for (const s of slots) map[s.id] = null;

    const seed = effectiveInitialSquad ?? [];
    const by: Record<Position, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const p of seed) by[p.position].push(p);
    for (const pos of Object.keys(by) as Position[]) by[pos].sort((a, b) => a.id - b.id);
    for (const s of slots) map[s.id] = by[s.position].shift() ?? null;

    setAssign(map);
    setPicker(null);
    setQ("");
    setLastRemoved(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialSquad, autoInitialSquad, autoLoaded]);

  // close picker when clicking outside whole component
  useEffect(() => {
    function onDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
        // no-op
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    };
  }, []);

  const picked = useMemo(() => Object.values(assign).filter(Boolean) as Player[], [assign]);
  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);

  const totalValue = useMemo(() => picked.reduce((s, p) => s + p.value, 0), [picked]);
  const remainingBudget = props.budget - totalValue;

  function assignTo(slotId: string, p: Player) {
    const current = assign[slotId];

    // prevent duplicates
    if (pickedIds.has(p.id) && current?.id !== p.id) return;

    // budget check
    const nextTotal = totalValue - (current?.value ?? 0) + p.value;
    if (nextTotal > props.budget) return;

    setAssign((prev) => ({ ...prev, [slotId]: p }));
  }

  function removeFrom(slotId: string) {
    const removed = assign[slotId];
    if (!removed) return;

    setLastRemoved({ slotId, player: removed });
    setAssign((prev) => ({ ...prev, [slotId]: null }));

    // Open picker immediately for replacement
    setQ("");
    setPicker({ slotId, pos: removed.position });

    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setLastRemoved(null), 6000);
  }

  function undoRemove() {
    if (!lastRemoved) return;

    const { slotId, player } = lastRemoved;

    // only undo if still empty and player not already elsewhere
    const stillEmpty = !assign[slotId];
    const alreadyPicked = pickedIds.has(player.id);

    if (stillEmpty && !alreadyPicked) {
      setAssign((prev) => ({ ...prev, [slotId]: player }));
    }

    setLastRemoved(null);
  }

  const pickerOut = useMemo(() => {
    if (!picker) return null;
    return assign[picker.slotId] ?? null;
  }, [picker, assign]);

  function fmtPos(pos: Position) {
    return pos === "FWD" ? "ST" : pos;
  }

  const availableForPicker = useMemo(() => {
    if (!picker) return [];
    const slotAssigned = assign[picker.slotId];

    const qq = q.trim().toLowerCase();

    return props.players
      .filter((p) => p.position === picker.pos)
      .filter((p) => !pickedIds.has(p.id) || p.id === slotAssigned?.id)
      .filter((p) => !qq || p.name.toLowerCase().includes(qq))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [picker, props.players, pickedIds, assign, q]);

  const canSave = picked.length === 15 && remainingBudget >= 0;

  return (
    <div ref={rootRef} className="squad-builder">
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

                return (
                  <div
                    key={s.id}
                    className={`slot ${assigned ? "slot-filled" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => {
                      setQ("");
                      setPicker({ slotId: s.id, pos: s.position });
                    }}
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
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Undo toast */}
      {lastRemoved && (
        <div className="undo-toast" role="status" aria-live="polite">
          <span className="undo-dot" aria-hidden="true" />
          <span className="undo-text">
            Pelaaja poistettu: <b>{lastRemoved.player.name}</b>
          </span>
          <button type="button" className="undo-btn" onClick={undoRemove}>
            Kumoa
          </button>
        </div>
      )}

      <div className="starting-xi-controls" style={{ marginTop: 12 }}>
        <button className="xi-save" disabled={!canSave} onClick={() => props.onSave(picked)}>
          Tallenna
        </button>
      </div>

      {/* Bottom-sheet picker */}
      {picker && (
        <div className="picker-backdrop" onClick={() => setPicker(null)} role="dialog" aria-modal="true">
          <div className="picker-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <div className="picker-title">
                Valitse pelaaja <span className="picker-pos">({fmtPos(picker.pos)})</span>
              </div>

              <button className="picker-close" onClick={() => setPicker(null)} aria-label="Sulje">
                ✕
              </button>
            </div>

            {/* OUT player (who is being replaced) */}
            <div className="picker-out">
              <div className="picker-out-label">Ulos</div>
              {pickerOut ? (
                <div className="picker-out-card">
                  <div className="picker-out-name">{pickerOut.name}</div>
                  <div className="picker-out-sub">
                    {teamName(props.teams, pickerOut.teamId)} • {pickerOut.value.toFixed(1)} M
                  </div>
                </div>
              ) : (
                <div className="picker-out-card picker-out-card--empty">Tyhjä paikka</div>
              )}
            </div>

            <input className="picker-search" placeholder="Hae pelaajaa..." value={q} onChange={(e) => setQ(e.target.value)} />

            <div className="picker-list">
              {availableForPicker.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="picker-row"
                  onClick={() => {
                    assignTo(picker.slotId, p);
                    setPicker(null);
                  }}
                >
                  <div className="picker-row-main">
                    <div className="picker-name">{p.name}</div>
                    <div className="picker-team">{teamName(props.teams, p.teamId)}</div>
                  </div>
                  <div className="picker-price">{p.value.toFixed(1)} M</div>
                </button>
              ))}

              {availableForPicker.length === 0 && <div className="picker-empty">Ei saatavilla</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}