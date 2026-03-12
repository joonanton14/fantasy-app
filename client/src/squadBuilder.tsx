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
  isLocked?: boolean;
  transferLimit: number;
  transferUsed: number;
  onSave: (squad: Player[]) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const slots = useMemo(() => buildSquad15Slots(), []);

  const [assign, setAssign] = useState<Record<string, Player | null>>(() => {
    const map: Record<string, Player | null> = {};
    for (const s of slots) map[s.id] = null;
    return map;
  });

  function countTransfers(oldSquadIds: number[], newSquadIds: number[]) {
    const oldSet = new Set(oldSquadIds);
    const newSet = new Set(newSquadIds);

    const outgoing = oldSquadIds.filter((id) => !newSet.has(id));
    const incoming = newSquadIds.filter((id) => !oldSet.has(id));

    if (outgoing.length !== incoming.length) {
      return 999;
    }

    return outgoing.length;
  }

  const [picker, setPicker] = useState<{ slotId: string; pos: Position } | null>(null);
  const [q, setQ] = useState("");
  const [pendingRestore, setPendingRestore] = useState<{ slotId: string; player: Player } | null>(null);
  const [onlySuitable, setOnlySuitable] = useState(false);
  const [sortBy, setSortBy] = useState<"name" | "price-asc" | "price-desc" | "team">("name");

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
    setOnlySuitable(false);
    setSortBy("name");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialSquad]);

  useEffect(() => {
    if (props.isLocked) {
      setPicker(null);
      setPendingRestore(null);
    }
  }, [props.isLocked]);

  const picked = useMemo(() => Object.values(assign).filter(Boolean) as Player[], [assign]);
  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked]);

  const totalValue = useMemo(() => picked.reduce((s, p) => s + p.value, 0), [picked]);
  const remainingBudget = props.budget - totalValue;
  const initialSquadIds = useMemo(
    () => (props.initialSquad ?? []).map((p) => p.id),
    [props.initialSquad]
  );

  const pickedSquadIds = useMemo(
    () => picked.map((p) => p.id),
    [picked]
  );

  const plannedTransfers = useMemo(
    () => countTransfers(initialSquadIds, pickedSquadIds),
    [initialSquadIds, pickedSquadIds]
  );

  const transferLimitValue = props.transferLimit ?? 3;
  const transferUsedValue = props.transferUsed ?? 0;
  const remainingTransfers = Math.max(0, transferLimitValue - transferUsedValue);
  const overTransferLimit = plannedTransfers > remainingTransfers;

  function assignTo(slotId: string, p: Player) {
    if (transfersBlocked) return;

    const current = assign[slotId];

    if (pickedIds.has(p.id) && current?.id !== p.id) return;

    const nextTotal = totalValue - (current?.value ?? 0) + p.value;
    if (nextTotal > props.budget) return;

    let sameTeamCount = 0;
    for (const [id, pl] of Object.entries(assign)) {
      if (!pl) continue;
      if (id === slotId) continue;
      if (pl.teamId === p.teamId) sameTeamCount++;
    }
    if (sameTeamCount >= 3) return;

    setAssign((prev) => ({ ...prev, [slotId]: p }));

    if (pendingRestore?.slotId === slotId) {
      setPendingRestore(null);
    }
  }

  function removeFrom(slotId: string) {
    if (transfersBlocked) return;

    const removed = assign[slotId];
    if (!removed) return;

    setPendingRestore({ slotId, player: removed });
    setAssign((prev) => ({ ...prev, [slotId]: null }));
    setQ("");
    setOnlySuitable(false);
    setSortBy("name");
    setPicker({ slotId, pos: removed.position });
  }

  function closePickerAndRestore() {
    if (picker && pendingRestore?.slotId === picker.slotId && !assign[picker.slotId]) {
      setAssign((prev) => ({
        ...prev,
        [picker.slotId]: pendingRestore.player,
      }));
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

  const transferBudget = useMemo(() => {
    if (!picker) return 0;
    const slotAssigned = assign[picker.slotId];
    const outgoingValue = slotAssigned?.value ?? 0;
    return remainingBudget + outgoingValue;
  }, [picker, assign, remainingBudget]);

  function fmtPos(pos: Position) {
    return pos === "FWD" ? "ST" : pos;
  }

  const availableForPicker = useMemo(() => {
    if (!picker) return [];

    const slotAssigned = assign[picker.slotId];
    const qq = q.trim().toLowerCase();
    const removedForThisSlot =
      pendingRestore?.slotId === picker.slotId ? pendingRestore.player : null;

    const teamCounts = new Map<number, number>();
    for (const [slotId, pl] of Object.entries(assign)) {
      if (!pl) continue;
      if (slotId === picker.slotId) continue;
      teamCounts.set(pl.teamId, (teamCounts.get(pl.teamId) ?? 0) + 1);
    }

    let rows = props.players
      .filter((p) => p.position === picker.pos)
      .filter((p) => !qq || p.name.toLowerCase().includes(qq))
      .filter((p) => p.id !== removedForThisSlot?.id)
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
            ? "Valittuna joukkueessa"
            : teamLimitExceeded
              ? "3 pelaajaa jo tästä joukkueesta"
              : tooExpensive
                ? "Ei riittävästi rahaa tähän siirtoon"
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
  }, [picker, assign, q, props.players, pickedIds, transferBudget, onlySuitable, sortBy, props.teams, pendingRestore]);

  const canSave =
    picked.length === 15 &&
    remainingBudget >= 0 &&
    !overTransferLimit;

  const noTransfersLeft = remainingTransfers <= 0;
  const transfersBlocked = !props.isLocked && noTransfersLeft;

  return (
    <div ref={rootRef} className="starting-xi-root squad-builder">
      <div className="starting-xi-card">
        <header className="starting-xi-header">
          <h3>Joukkue</h3>

          <div className="squad-meta">
            <div className="squad-meta-pill">
              <span className="squad-meta-label">Budjetti</span>
              <span className="squad-meta-value">{remainingBudget.toFixed(1)} M</span>
            </div>

            <div className="squad-meta-pill">
              <span className="squad-meta-label">Vaihdot</span>
              <span className="squad-meta-value">
                {remainingTransfers} <span className="squad-meta-total">/ {transferLimitValue}</span>
              </span>
            </div>
          </div>

          {props.isLocked && (
            <div className="starting-xi-warning" role="alert">
              Kierroksen ensimmäinen ottelu on alkanut — vaihdot ovat lukittu.
            </div>
          )}

          {noTransfersLeft && !props.isLocked && (
            <div className="starting-xi-warning" role="alert">
              Sinulla ei ole enää vaihtoja tälle kierrokselle.
            </div>
          )}
        </header>

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
                        if (transfersBlocked) return;
                        setQ("");
                        setOnlySuitable(false);
                        setSortBy("name");
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
                            disabled={transfersBlocked}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (transfersBlocked) return;
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
          <button
            className="xi-save"
            disabled={!canSave || !!props.isLocked}
            onClick={() => {
              if (props.isLocked) return;
              props.onSave(picked);
            }}
          >
            Tallenna
          </button>
        </div>

        {picker && !props.isLocked && (
          <div
            className="picker-backdrop"
            onClick={closePickerAndRestore}
            role="dialog"
            aria-modal="true"
          >
            <div className="picker-sheet" onClick={(e) => e.stopPropagation()}>
              <div className="picker-head">
                <div className="picker-title">
                  Valitse pelaaja <span className="picker-pos">({fmtPos(picker.pos)})</span>
                </div>

                <button className="picker-close" onClick={closePickerAndRestore} aria-label="Sulje">
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
                  <div className="picker-out-card picker-out-card--empty">Tyhjä paikka</div>
                )}
              </div>

              <div className="app-muted" style={{ marginBottom: 10 }}>
                Rahaa käytettävissä siirtoon: <b>{transferBudget.toFixed(1)} M</b>
              </div>

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
                      setPendingRestore(null);
                      setPicker(null);
                      setQ("");
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
    </div>
  );
}