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
  initial?: Player[];          // Starting XI players
  initialBench?: Player[];     // Bench players (1 GK + 3 field)
  onSave: (payload: { startingXI: Player[]; bench: Player[] }) => void;
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

type BenchSlot = { id: string; label: string; kind: 'GK' | 'FIELD' };

const BENCH_SLOTS: BenchSlot[] = [
  { id: 'bench-gk', label: 'MV', kind: 'GK' },
  { id: 'bench-1', label: 'PENKKI', kind: 'FIELD' },
  { id: 'bench-2', label: 'PENKKI', kind: 'FIELD' },
  { id: 'bench-3', label: 'PENKKI', kind: 'FIELD' },
];

const handleSave = async ({ startingXI, bench }: { startingXI: Player[]; bench: Player[] }) => {
  await fetch("/api/user-team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: {
        startingXIIds: startingXI.map((p) => p.id),
        benchIds: bench.map((p) => p.id),
      },
    }),
  });
};

export const StartingXI: FC<Props> = ({
  players,
  teams,
  initial = [],
  initialBench = [],
  onSave,
  budget = 100,
  readOnly = false,
}) => {
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

  const [benchAssignments, setBenchAssignments] = useState<Record<string, Player | null>>(() => {
    const map: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (map[s.id] = null));

    // place initial bench: first GK goes to bench-gk, rest into bench-1..3
    const gk = initialBench.find((p) => p.position === 'GK') ?? null;
    const field = initialBench.filter((p) => p.position !== 'GK').slice(0, 3);

    map['bench-gk'] = gk;
    map['bench-1'] = field[0] ?? null;
    map['bench-2'] = field[1] ?? null;
    map['bench-3'] = field[2] ?? null;

    return map;
  });

  const [openSlot, setOpenSlot] = useState<string | null>(null);

  // Sync when parent passes new initial values (e.g. loaded from Redis)
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

    const bmap: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (bmap[s.id] = null));
    const gk = initialBench.find((p) => p.position === 'GK') ?? null;
    const field = initialBench.filter((p) => p.position !== 'GK').slice(0, 3);
    bmap['bench-gk'] = gk;
    bmap['bench-1'] = field[0] ?? null;
    bmap['bench-2'] = field[1] ?? null;
    bmap['bench-3'] = field[2] ?? null;

    setSlots(baseSlots);
    setSlotAssignments(map);
    setBenchAssignments(bmap);
    setOpenSlot(null);

  }, [initial, initialBench, formation]);

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

  const xiPlayers = useMemo(() => Object.values(slotAssignments).filter(Boolean) as Player[], [slotAssignments]);
  const benchPlayers = useMemo(() => Object.values(benchAssignments).filter(Boolean) as Player[], [benchAssignments]);

  const totalValue = useMemo(() => {
    return [...xiPlayers, ...benchPlayers].reduce((sum, p) => sum + p.value, 0);
  }, [xiPlayers, benchPlayers]);

  const remainingBudget = useMemo(() => budget - totalValue, [budget, totalValue]);

  const f = FORMATIONS[formation];
  const counts = (pos: Player['position']) => countByPos(xiPlayers, pos);
  const teamCountAll = (teamId: number) => [...xiPlayers, ...benchPlayers].filter((p) => p.teamId === teamId).length;

  const LIMITS = useMemo(() => {
    return {
      GK: { min: 1, max: 1 },
      DEF: { min: f.DEF, max: f.DEF },
      MID: { min: f.MID, max: f.MID },
      FWD: { min: f.FWD, max: f.FWD },
    };
  }, [f.DEF, f.MID, f.FWD]);

  function isPickedAnywhere(id: number) {
    return [...xiPlayers, ...benchPlayers].some((p) => p.id === id);
  }

  function canAssignToXI(p: Player) {
    if (isPickedAnywhere(p.id)) return false;
    if (teamCountAll(p.teamId) >= 3) return false;

    const max = (LIMITS as any)[p.position].max as number;
    if (counts(p.position) >= max) return false;

    if (totalValue + p.value > budget) return false;
    return true;
  }

  function canAssignToBench(slotKind: 'GK' | 'FIELD', p: Player) {
    if (isPickedAnywhere(p.id)) return false;
    if (teamCountAll(p.teamId) >= 3) return false;

    if (slotKind === 'GK' && p.position !== 'GK') return false;
    if (slotKind === 'FIELD' && p.position === 'GK') return false;

    if (totalValue + p.value > budget) return false;
    return true;
  }

  function assignToXISlot(slotId: string, p: Player) {
    if (readOnly) return;
    if (!canAssignToXI(p)) return;
    setSlotAssignments((prev) => ({ ...prev, [slotId]: p }));
    setOpenSlot(null);
  }

  function removeFromXISlot(slotId: string) {
    if (readOnly) return;
    setSlotAssignments((prev) => ({ ...prev, [slotId]: null }));
  }

  function assignToBenchSlot(slotId: string, slotKind: 'GK' | 'FIELD', p: Player) {
    if (readOnly) return;
    if (!canAssignToBench(slotKind, p)) return;
    setBenchAssignments((prev) => ({ ...prev, [slotId]: p }));
    setOpenSlot(null);
  }

  function removeFromBenchSlot(slotId: string) {
    if (readOnly) return;
    setBenchAssignments((prev) => ({ ...prev, [slotId]: null }));
  }

  function isValidXI() {
    if (xiPlayers.length !== 11) return false;
    return (
      counts('GK') === LIMITS.GK.max &&
      counts('DEF') === LIMITS.DEF.max &&
      counts('MID') === LIMITS.MID.max &&
      counts('FWD') === LIMITS.FWD.max
    );
  }

  function isValidBench() {
    if (benchPlayers.length !== 4) return false;
    const gkCount = benchPlayers.filter((p) => p.position === 'GK').length;
    const fieldCount = benchPlayers.filter((p) => p.position !== 'GK').length;
    return gkCount === 1 && fieldCount === 3;
  }

  function applyFormation(next: FormationKey) {
    if (readOnly) return;

    const nextSlots = buildSlots(next);
    const nextReq = FORMATIONS[next];

    // Pool = current XI + bench (prefer XI order first so starters stay starters)
    const xiNow = Object.values(slotAssignments).filter(Boolean) as Player[];
    const benchNow = Object.values(benchAssignments).filter(Boolean) as Player[];
    const pool = [...xiNow, ...benchNow];

    // Split pool by position (preserves order!)
    const poolByPos: Record<Player["position"], Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const p of pool) poolByPos[p.position].push(p);

    // --- Build new XI assignments ---
    const nextMap: Record<string, Player | null> = {};
    nextSlots.forEach((s) => (nextMap[s.id] = null));

    // GK (exactly 1)
    const gkPick = poolByPos.GK.shift() ?? null;
    if (gkPick) nextMap["gk-1"] = gkPick;

    // Fill required DEF/MID/FWD
    const fillPos = (pos: "DEF" | "MID" | "FWD", count: number) => {
      const slotsForPos = nextSlots.filter((s) => s.position === pos);
      for (let i = 0; i < count; i++) {
        const p = poolByPos[pos].shift() ?? null;
        if (p) nextMap[slotsForPos[i].id] = p;
      }
    };

    fillPos("DEF", nextReq.DEF);
    fillPos("MID", nextReq.MID);
    fillPos("FWD", nextReq.FWD);

    // --- Build new bench from leftovers ---
    // Remaining poolByPos now contains leftover players not used in XI
    const leftoverGK = poolByPos.GK.shift() ?? null;

    // Bench field: take leftovers in a stable “nice” order (MID/DEF/FWD), still preserving each list order
    const leftoverField: Player[] = [
      ...poolByPos.MID,
      ...poolByPos.DEF,
      ...poolByPos.FWD,
    ].filter((p) => p.position !== "GK");

    const nextBenchMap: Record<string, Player | null> = {};
    BENCH_SLOTS.forEach((s) => (nextBenchMap[s.id] = null));

    nextBenchMap["bench-gk"] = leftoverGK;
    nextBenchMap["bench-1"] = leftoverField[0] ?? null;
    nextBenchMap["bench-2"] = leftoverField[1] ?? null;
    nextBenchMap["bench-3"] = leftoverField[2] ?? null;

    setFormation(next);
    setSlots(nextSlots);
    setSlotAssignments(nextMap);
    setBenchAssignments(nextBenchMap);
    setOpenSlot(null);
  }

  const saveDisabled = !(isValidXI() && isValidBench() && remainingBudget >= 0);

  const Row = ({ position, label }: { position: Player['position']; label: string }) => {
    const rowSlots = slots.filter((s) => s.position === position);

    return (
      <div className={`pitch-row pitch-cols-${rowSlots.length}`}>
        {rowSlots.map((s) => {
          const assigned = slotAssignments[s.id];
          const isOpen = openSlot === s.id;

          const available = players
            .filter((p) => p.position === s.position && canAssignToXI(p))
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
                        removeFromXISlot(s.id);
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
                      <button key={p.id} type="button" className="slot-pop-btn" onClick={() => assignToXISlot(s.id, p)}>
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
    return (
      <div className="bench">
        <h3 className="app-h2" style={{ marginTop: 16 }}>Penkki</h3>
        <div className="bench-row">
          {BENCH_SLOTS.map((s) => {
            const assigned = benchAssignments[s.id];
            const isOpen = openSlot === s.id;

            const available = players
              .filter((p) => canAssignToBench(s.kind, p))
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
                          removeFromBenchSlot(s.id);
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
                          onClick={() => assignToBenchSlot(s.id, s.kind, p)}
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
            Valitse 1 maalivahti ja 3 kenttäpelaajaa.
          </div>
        )}
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
              Käytetty: <b>{totalValue.toFixed(1)}</b> / {budget} M
            </div>

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

            <div className="meta-pill">
              Jäljellä: <b>{remainingBudget.toFixed(1)}</b> M
            </div>
          </div>

          {remainingBudget < 0 && (
            <div className="starting-xi-warning" role="alert">
              Budjetti ylittyy. Poista tai vaihda pelaajia.
            </div>
          )}

          {!isValidXI() && (
            <div className="starting-xi-warning" role="alert">
              Avaus ei ole kelvollinen.
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
              onClick={() => onSave({ startingXI: xiPlayers, bench: benchPlayers })}
              disabled={saveDisabled}
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
