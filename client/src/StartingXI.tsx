import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { FC } from 'react';

interface Player {
  id: number;
  name: string;
  position: 'GK' | 'DEF' | 'MID' | 'FWD';
  teamId: number;
  value: number;
}

interface Team {
  id: number;
  name: string;
}

interface Props {
  players: Player[];
  teams: Team[];
  initial?: Player[];
  onSave: (selected: Player[]) => void;
  budget?: number;
  readOnly?: boolean;
}

type FormationKey = '3-5-2' | '3-4-3' | '4-4-2' | '4-3-3' | '4-5-1' | '5-3-2' | '5-4-1';

const FORMATIONS: Record<FormationKey, { DEF: number; MID: number; FWD: number }> = {
  '3-5-2': { DEF: 3, MID: 5, FWD: 2 },
  '3-4-3': { DEF: 3, MID: 4, FWD: 3 },
  '4-4-2': { DEF: 4, MID: 4, FWD: 2 },
  '4-3-3': { DEF: 4, MID: 3, FWD: 3 },
  '4-5-1': { DEF: 4, MID: 5, FWD: 1 },
  '5-3-2': { DEF: 5, MID: 3, FWD: 2 },
  '5-4-1': { DEF: 5, MID: 4, FWD: 1 },
};

type Slot = { id: string; position: Player['position'] };

function buildSlots(formation: FormationKey): Slot[] {
  const f = FORMATIONS[formation];
  const slots: Slot[] = [{ id: 'gk-1', position: 'GK' }];
  for (let i = 1; i <= f.DEF; i++) slots.push({ id: `def-${i}`, position: 'DEF' });
  for (let i = 1; i <= f.MID; i++) slots.push({ id: `mid-${i}`, position: 'MID' });
  for (let i = 1; i <= f.FWD; i++) slots.push({ id: `fwd-${i}`, position: 'FWD' });
  return slots;
}

function countByPos(list: Player[], pos: Player['position']) {
  return list.filter((p) => p.position === pos).length;
}

export const StartingXI: FC<Props> = ({ players, teams, initial = [], onSave, budget = 100, readOnly = false }) => {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [formation, setFormation] = useState<FormationKey>('4-4-2');
  const [slots, setSlots] = useState<Slot[]>(() => buildSlots('4-4-2'));

  const [slotAssignments, setSlotAssignments] = useState<Record<string, Player | null>>(() => {
    const baseSlots = buildSlots('4-4-2');
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

  const [openSlot, setOpenSlot] = useState<string | null>(null);

  // Keep internal assignments in sync if parent passes a new `initial` (e.g. loaded from Redis)
  useEffect(() => {
    const baseSlots = buildSlots(formation);
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
  }, [initial]);

  // Close selection popover when clicking outside component
  useEffect(() => {
    function handlePointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpenSlot(null);
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, []);

  const assignedPlayers = useMemo(() => {
    return Object.values(slotAssignments).filter(Boolean) as Player[];
  }, [slotAssignments]);

  const totalValue = useMemo(() => {
    return assignedPlayers.reduce((sum, p) => sum + p.value, 0);
  }, [assignedPlayers]);

  const remainingBudget = useMemo(() => {
    return budget - totalValue;
  }, [budget, totalValue]);

  const f = FORMATIONS[formation];

  const counts = (pos: Player['position']) => countByPos(assignedPlayers, pos);
  const teamCount = (teamId: number) => assignedPlayers.filter((p) => p.teamId === teamId).length;

  const LIMITS = useMemo(() => {
    return {
      GK: { min: 1, max: 1 },
      DEF: { min: f.DEF, max: f.DEF },
      MID: { min: f.MID, max: f.MID },
      FWD: { min: f.FWD, max: f.FWD },
    };
  }, [f.DEF, f.MID, f.FWD]);

  function canAssign(p: Player) {
    if (assignedPlayers.some((a) => a.id === p.id)) return false;
    if (teamCount(p.teamId) >= 3) return false;

    const max = (LIMITS as any)[p.position].max as number;
    if (counts(p.position) >= max) return false;

    // ✅ Budget check
    if (totalValue + p.value > budget) return false;

    return true;
  }

  function assignToSlot(slotId: string, p: Player) {
    if (readOnly) return;
    if (!canAssign(p)) return;
    setSlotAssignments((prev) => ({ ...prev, [slotId]: p }));
    setOpenSlot(null);
  }

  function removeFromSlot(slotId: string) {
    if (readOnly) return;
    setSlotAssignments((prev) => ({ ...prev, [slotId]: null }));
  }

  function isValidFormation() {
    if (assignedPlayers.length !== 11) return false;
    return (
      counts('GK') === LIMITS.GK.max &&
      counts('DEF') === LIMITS.DEF.max &&
      counts('MID') === LIMITS.MID.max &&
      counts('FWD') === LIMITS.FWD.max
    );
  }

  function applyFormation(next: FormationKey) {
    if (readOnly) return;

    const nextSlots = buildSlots(next);

    const currentSelected = Object.values(slotAssignments).filter(Boolean) as Player[];
    const byPos: Record<Player['position'], Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    currentSelected.forEach((p) => byPos[p.position].push(p));

    const map: Record<string, Player | null> = {};
    nextSlots.forEach((s) => (map[s.id] = null));

    const remainingByPos: Record<Player['position'], Player[]> = {
      GK: [...byPos.GK],
      DEF: [...byPos.DEF],
      MID: [...byPos.MID],
      FWD: [...byPos.FWD],
    };

    for (const s of nextSlots) {
      const arr = remainingByPos[s.position];
      if (arr.length > 0) map[s.id] = arr.shift()!;
    }

    setFormation(next);
    setSlots(nextSlots);
    setSlotAssignments(map);
    setOpenSlot(null);
  }

  const saveDisabled = !isValidFormation();

  const Row = ({ position, label }: { position: Player['position']; label: string }) => {
    const rowSlots = slots.filter((s) => s.position === position);

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length}`}>
        {rowSlots.map((s) => {
          const assigned = slotAssignments[s.id];
          const isOpen = openSlot === s.id;

          const available = players
            .filter((p) => p.position === s.position && canAssign(p))
            .map((p) => ({
              ...p,
              teamName: teams.find((t) => t.id === p.teamId)?.name ?? '',
            }))
            .sort((a, b) => a.name.localeCompare(b.name));

          return (
            <div
              key={s.id}
              className={`slot ${assigned ? 'slot-filled' : ''} ${isOpen ? 'slot-open' : ''}`}
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
                        if (readOnly) return;
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
                <div
                  className="slot-pop"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="slot-pop-title">Valitse pelaaja</div>

                  <div className="slot-pop-list">
                    {available.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="slot-pop-btn"
                        onClick={() => assignToSlot(s.id, p)}
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

  return (
    <div className="starting-xi-root" ref={rootRef}>
      <div className="starting-xi-card">
        <header className="starting-xi-header">
          <h2>Avauskokoonpano</h2>

          <div className="starting-xi-meta">
            <div className="meta-pill">
              Valittuna: <b>{assignedPlayers.length}</b>/11
            </div>

            <div className="meta-pill">
              Käytetty: <b>{totalValue.toFixed(1)}</b> / {budget} M
            </div>

            <div className="meta-pill meta-formation">
              <span>
                Formaatiо: <b>{formation}</b>
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

            <div className="meta-pill">
              Jäljellä: <b>{remainingBudget.toFixed(1)}</b> M
            </div>

            <div className="meta-pill">
              3 / joukkue <span className="meta-sub">(max)</span>
            </div>
          </div>

          {remainingBudget < 0 && (
            <div className="starting-xi-warning" role="alert">
              Budjetti ylittyy. Poista tai vaihda pelaajia.
            </div>
          )}

          {!isValidFormation() && (
            <div className="starting-xi-warning" role="alert">
              Avaus ei ole kelvollinen valitulle formaatiolle. Täytä kaikki paikat.
            </div>
          )}
        </header>

        <div className="pitch">
          <Row position="GK" label="MV" />
          <Row position="DEF" label="P" />
          <Row position="MID" label="KK" />
          <Row position="FWD" label="H" />
        </div>

        <div className="starting-xi-controls">
          {!readOnly && (
            <button type="button" className="xi-save" onClick={() => onSave(assignedPlayers)} disabled={saveDisabled}>
              Tallenna avauskokoonpano
            </button>
          )}

          <div className="xi-limits">
            <span>GK: {counts('GK')}/1</span>
            <span>DEF: {counts('DEF')}/{f.DEF}</span>
            <span>MID: {counts('MID')}/{f.MID}</span>
            <span>FWD: {counts('FWD')}/{f.FWD}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StartingXI;
