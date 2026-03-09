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

  const [picker, setPicker] = useState<{ slotId: string; pos: Position } | null>(null);
  const [q, setQ] = useState("");

  const [onlySuitable, setOnlySuitable] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "price-asc" | "price-desc" | "team">("name");

  const [pendingRestore, setPendingRestore] = useState<{ slotId: string; player: Player } | null>(null);

  useEffect(() => {
    const map: Record<string, Player | null> = {};
    for (const s of slots) map[s.id] = null;

    const seed = props.initialSquad ?? [];
    const by: Record<Position, Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const p of seed) by[p.position].push(p);
    for (const pos of Object.keys(by) as Position[]) by[pos].sort((a, b) => a.id - b.id);
    for (const s of slots) map[s.id] = by[s.position].shift() ?? null;

    setAssign(map);
    setPicker(null);
    setQ("");
    setPendingRestore(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialSquad]);

  useEffect(() => {
    function onDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) {
      }
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

    if (pickedIds.has(p.id) && current?.id !== p.id) return;

    const nextTotal = totalValue - (current?.value ?? 0) + p.value;
    if (nextTotal > props.budget) return;

    setAssign((prev) => ({ ...prev, [slotId]: p }));

    if (pendingRestore?.slotId === slotId) {
      setPendingRestore(null);
    }
  }

  function removeFrom(slotId: string) {
    const removed = assign[slotId];
    if (!removed) return;

    setPendingRestore({ slotId, player: removed });
    setAssign((prev) => ({ ...prev, [slotId]: null }));

    setQ("");
    setPicker({ slotId, pos: removed.position });
  }

  function cancelTransfer() {
    if (!picker || !pendingRestore) {
      setPicker(null);
      return;
    }

    if (pendingRestore.slotId === picker.slotId && !assign[picker.slotId]) {
      setAssign((prev) => ({ ...prev, [picker.slotId]: pendingRestore.player }));
    }

    setPendingRestore(null);
    setPicker(null);
    setQ("");
  }

  const pickerOut = useMemo(() => {
    if (!picker) return null;

    if (pendingRestore?.slotId === picker.slotId) return pendingRestore.player;

    return assign[picker.slotId] ?? null;
  }, [picker, assign, pendingRestore]);

  function fmtPos(pos: Position) {
    return pos === "FWD" ? "ST" : pos;
  }

  const transferBudget = useMemo(() => {
    if (!picker) return 0;
    const slotAssigned = assign[picker.slotId];
    const outgoingValue = slotAssigned?.value ?? 0;
    return remainingBudget + outgoingValue;
  }, [picker, assign, remainingBudget]);

  const availableForPicker = useMemo(() => {
    if (!picker) return [];

    const slotAssigned = assign[picker.slotId];
    const qq = q.trim().toLowerCase();

    const teamCounts = new Map<number, number>();
    for (const [slotId, pl] of Object.entries(assign)) {
      if (!pl) continue;
      if (slotId === picker.slotId) continue;
      teamCounts.set(pl.teamId, (teamCounts.get(pl.teamId) ?? 0) + 1);
    }

    let rows = props.players
      .filter((p) => p.position === picker.pos)
      .filter((p) => !qq || p.name.toLowerCase().includes(qq))
      .map((p) => {
        const isSameCurrent = p.id === slotAssigned?.id;
        const isPickedElsewhere = pickedIds.has(p.id) && !isSameCurrent;

        const nextTeamCount = (teamCounts.get(p.teamId) ?? 0) + 1;
        const teamLimitExceeded = nextTeamCount > 3;

        const tooExpensive = p.value > transferBudget;

        const disabled = isPickedElsewhere || teamLimitExceeded || tooExpensive;

        return {
          player: p,
          disabled,
          suitable: !disabled,
          reason: isPickedElsewhere
            ? "Pelaaja jo valittu"
            : teamLimitExceeded
              ? "Maksimimäärä pelaajia jo valittuna tästä joukkueelta"
              : tooExpensive
                ? "Ei riittävästi rahaa"
                : null,
        };
      });

    if (onlySuitable) {
      rows = rows.filter((row) => row.suitable);
    }

    rows.sort((a, b) => {
      if (!onlySuitable && a.disabled !== b.disabled) {
        return a.disabled ? 1 : -1;
      }

      switch (sortBy) {
        case "price-asc":
          return a.player.value - b.player.value || a.player.name.localeCompare(b.player.name);

        case "price-desc":
          return b.player.value - a.player.value || a.player.name.localeCompare(b.player.name);

        case "team":
          return (
            teamName(props.teams, a.player.teamId).localeCompare(teamName(props.teams, b.player.teamId)) ||
            a.player.name.localeCompare(b.player.name)
          );

        case "name":
        default:
          return a.player.name.localeCompare(b.player.name);
      }
    });

    return rows;
  }, [picker, assign, q, props.players, pickedIds, transferBudget, onlySuitable, sortBy, props.teams]);

  const canSave = picked.length === 15 && remainingBudget >= 0;

  return (
    <div ref={rootRef} className="squad-builder">
      <div className="app-muted" style={{ marginBottom: 8 }}>
        Rahaa jäljellä: <b>{remainingBudget.toFixed(1)} M</b>
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
                      setPendingRestore(null);
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

      <div className="starting-xi-controls" style={{ marginTop: 12 }}>
        <button className="xi-save" disabled={!canSave} onClick={() => props.onSave(picked)}>
          Tallenna
        </button>
      </div>

      {picker && (
        <div
          className="picker-backdrop"
          onClick={() => {
            setPicker(null);
            setQ("");
          }}
          role="dialog"
          aria-modal="true"
        >
          <div className="picker-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <div className="picker-title">
                Valitse <span className="picker-pos">({fmtPos(picker.pos)})</span>
              </div>

              <button
                className="picker-close"
                onClick={() => {
                  setPicker(null);
                  setQ("");
                }}
                aria-label="Sulje"
              >
                ✕
              </button>
            </div>

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
                <div className="picker-out-card picker-out-card--empty">Tyhjä</div>
              )}
            </div>

            <div className="app-muted" style={{ marginBottom: 10 }}>
              Rahaa käytettävissä: <b>{transferBudget.toFixed(1)} M</b>
            </div>

            {pendingRestore?.slotId === picker.slotId && (
              <div style={{ marginBottom: 10 }}>
                <button type="button" className="picker-cancel-transfer" onClick={cancelTransfer}>
                  Peru
                </button>
              </div>
            )}

            <input
              className="picker-search"
              placeholder="Hae pelaajaa..."
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />

            <div className="picker-tools">
              <label className="picker-toggle">
                <input
                  type="checkbox"
                  checked={onlySuitable}
                  onChange={(e) => setOnlySuitable(e.target.checked)}
                />
                <span>Näytä vain sopivat</span>
              </label>

              <select
                className="picker-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "name" | "price-asc" | "price-desc" | "team")}
              >
                <option value="name">Järjestä: Nimi</option>
                <option value="price-asc">Järjestä: Hinta ↑</option>
                <option value="price-desc">Järjestä: Hinta ↓</option>
                <option value="team">Järjestä: Joukkue</option>
              </select>
            </div>

            <div className="picker-list">
              {availableForPicker.map(({ player, disabled, reason }) => (
                <button
                  key={player.id}
                  type="button"
                  className={`picker-row ${disabled ? "picker-row-disabled" : ""}`}
                  disabled={disabled}
                  onClick={() => {
                    assignTo(picker.slotId, player);
                    setPicker(null);
                  }}
                >
                  <div className="picker-row-main">
                    <div className="picker-name">{player.name}</div>
                    <div className="picker-team">
                      {teamName(props.teams, player.teamId)}
                      {reason && <span className="picker-reason"> • {reason}</span>}
                    </div>
                  </div>
                  <div className="picker-price">{player.value.toFixed(1)} M</div>
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