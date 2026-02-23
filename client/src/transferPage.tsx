// client/src/TransfersPage.tsx
import React, { useMemo, useState } from "react";

type Player = {
  id: number;
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  teamId: number;
  value: number;
};

type Team = { id: number; name: string };

type FormationKey = "3-5-2" | "3-4-3" | "4-4-2" | "4-3-3" | "4-5-1" | "5-3-2" | "5-4-1";

const FORMATIONS: Record<FormationKey, { DEF: number; MID: number; FWD: number }> = {
  "3-5-2": { DEF: 3, MID: 5, FWD: 2 },
  "3-4-3": { DEF: 3, MID: 4, FWD: 3 },
  "4-4-2": { DEF: 4, MID: 4, FWD: 2 },
  "4-3-3": { DEF: 4, MID: 3, FWD: 3 },
  "4-5-1": { DEF: 4, MID: 5, FWD: 1 },
  "5-3-2": { DEF: 5, MID: 3, FWD: 2 },
  "5-4-1": { DEF: 5, MID: 4, FWD: 1 },
};

function sumValue(list: Player[]) {
  return list.reduce((s, p) => s + p.value, 0);
}

function countByPos(list: Player[], pos: Player["position"]) {
  return list.filter((p) => p.position === pos).length;
}

function inferFormationFromXI(xi: Player[]): FormationKey | null {
  // xi expected length 11, but we can still infer from counts
  const def = countByPos(xi, "DEF");
  const mid = countByPos(xi, "MID");
  const fwd = countByPos(xi, "FWD");

  const hit = (Object.keys(FORMATIONS) as FormationKey[]).find((k) => {
    const f = FORMATIONS[k];
    return f.DEF === def && f.MID === mid && f.FWD === fwd && countByPos(xi, "GK") === 1;
  });

  return hit ?? null;
}

function buildTeamCount(list: Player[]) {
  const map = new Map<number, number>();
  for (const p of list) map.set(p.teamId, (map.get(p.teamId) ?? 0) + 1);
  return map;
}

function uniqueById(list: Player[]) {
  const seen = new Set<number>();
  const out: Player[] = [];
  for (const p of list) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/**
 * Build startingXI + bench from a 15-player squad.
 * - formation: prefer inferred from oldStartingXI if valid; else 4-4-2
 * - priority: keep oldStartingXI players in XI if possible
 * - bench: prefer keeping oldBench players on bench if possible
 */
function splitSquadIntoXIAndBench(args: {
  squad: Player[];
  oldStartingXI: Player[];
  oldBench: Player[];
}): { startingXI: Player[]; bench: Player[]; formationUsed: FormationKey } {
  const { squad, oldStartingXI, oldBench } = args;

  const formationUsed: FormationKey = inferFormationFromXI(oldStartingXI) ?? "4-4-2";
  const req = FORMATIONS[formationUsed];

  const squadByPos: Record<Player["position"], Player[]> = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of squad) squadByPos[p.position].push(p);

  const oldXISet = new Set(oldStartingXI.map((p) => p.id));
  const oldBenchSet = new Set(oldBench.map((p) => p.id));

  // Helper: pick players from squadByPos[pos], prioritizing ones in prioritySet
  function pick(pos: Player["position"], n: number, prioritySet: Set<number>): Player[] {
    const pool = squadByPos[pos];
    const picked: Player[] = [];

    // first priority
    for (let i = 0; i < pool.length && picked.length < n; ) {
      const p = pool[i];
      if (prioritySet.has(p.id)) {
        picked.push(p);
        pool.splice(i, 1);
      } else i++;
    }

    // then anyone
    for (let i = 0; i < pool.length && picked.length < n; ) {
      picked.push(pool[i]);
      pool.splice(i, 1);
    }

    return picked;
  }

  // Build XI
  const xi: Player[] = [];
  xi.push(...pick("GK", 1, oldXISet));
  xi.push(...pick("DEF", req.DEF, oldXISet));
  xi.push(...pick("MID", req.MID, oldXISet));
  xi.push(...pick("FWD", req.FWD, oldXISet));

  // Remaining players after XI pick are in squadByPos pools now
  // Build bench: 1 GK + 3 field
  const bench: Player[] = [];
  bench.push(...pick("GK", 1, oldBenchSet));

  // field bench (any non-GK) – prioritize old bench
  const fieldLeft: Player[] = [
    ...squadByPos.DEF,
    ...squadByPos.MID,
    ...squadByPos.FWD,
  ];

  // reorder to prefer old bench
  fieldLeft.sort((a, b) => Number(oldBenchSet.has(b.id)) - Number(oldBenchSet.has(a.id)));

  bench.push(...fieldLeft.slice(0, 3));

  return { startingXI: uniqueById(xi).slice(0, 11), bench: uniqueById(bench).slice(0, 4), formationUsed };
}

export default function TransfersPage(props: {
  players: Player[];
  teams: Team[];
  startingXI: Player[];
  bench: Player[];
  budget: number;
  onCancel: () => void;
  onSave: (payload: { startingXI: Player[]; bench: Player[] }) => void;
}) {
  // initial squad = xi + bench
  const [squad, setSquad] = useState<Player[]>(() => uniqueById([...(props.startingXI ?? []), ...(props.bench ?? [])]));

  const teamsById = useMemo(() => new Map(props.teams.map((t) => [t.id, t.name])), [props.teams]);

  const squadIds = useMemo(() => new Set(squad.map((p) => p.id)), [squad]);

  const total = useMemo(() => sumValue(squad), [squad]);
  const remaining = props.budget - total;

  const teamCounts = useMemo(() => buildTeamCount(squad), [squad]);

  const canAdd = (p: Player) => {
    if (squadIds.has(p.id)) return false;
    if (squad.length >= 15) return false;
    if ((teamCounts.get(p.teamId) ?? 0) >= 3) return false;
    if (total + p.value > props.budget) return false;
    return true;
  };

  const removeFromSquad = (id: number) => setSquad((prev) => prev.filter((p) => p.id !== id));
  const addToSquad = (p: Player) => {
    if (!canAdd(p)) return;
    setSquad((prev) => [...prev, p]);
  };

  // Validation before save: enforce 15 players + budget + 3/team + can form XI+bench
  const validation = useMemo(() => {
    const errors: string[] = [];

    if (squad.length !== 15) errors.push("Joukkueessa pitää olla 15 pelaajaa (nyt: " + squad.length + ").");
    if (total > props.budget) errors.push("Budjetti ylittyy.");
    for (const [teamId, c] of teamCounts.entries()) {
      if (c > 3) errors.push(`Liikaa pelaajia joukkueesta ${teamsById.get(teamId) ?? teamId} (max 3).`);
    }

    // Must be able to split into XI+bench properly
    const formation = inferFormationFromXI(props.startingXI) ?? "4-4-2";
    const req = FORMATIONS[formation];

    const gk = countByPos(squad, "GK");
    const def = countByPos(squad, "DEF");
    const mid = countByPos(squad, "MID");
    const fwd = countByPos(squad, "FWD");

    // minimums for XI+bench: XI needs req + GK1, bench needs GK1 + 3 field
    if (gk < 2) errors.push("Tarvitset vähintään 2 maalivahtia (1 avaukseen + 1 penkille).");

    if (def + mid + fwd < 13) errors.push("Tarvitset vähintään 13 kenttäpelaajaa (11+3, joista 1 voi olla MV).");

    // For XI, must have at least the formation counts available
    if (def < req.DEF) errors.push(`Puolustajia liian vähän avaukseen (${formation} vaatii ${req.DEF}).`);
    if (mid < req.MID) errors.push(`Keskikenttäpelaajia liian vähän avaukseen (${formation} vaatii ${req.MID}).`);
    if (fwd < req.FWD) errors.push(`Hyökkääjiä liian vähän avaukseen (${formation} vaatii ${req.FWD}).`);

    // Bench needs 3 field (non-GK)
    if (def + mid + fwd < 3) errors.push("Tarvitset 3 kenttäpelaajaa penkille.");

    return { ok: errors.length === 0, errors, formationAssumed: formation };
  }, [squad, total, props.budget, teamCounts, teamsById, props.startingXI]);

  const availablePlayers = useMemo(() => {
    // show all players; button disabled if cannot add
    // sort by value desc then name
    return props.players
      .slice()
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  }, [props.players]);

  return (
    <div className="app-card">
      <div className="app-section">
        <div className="app-section-header" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 className="app-h2" style={{ margin: 0 }}>Vaihdot</h2>
            <div className="app-muted" style={{ marginTop: 4 }}>
              Budjetti: {total.toFixed(1)} / {props.budget.toFixed(1)} M (jäljellä {remaining.toFixed(1)} M)
              {" · "}
              Avausmuoto oletuksena: <b>{validation.formationAssumed}</b>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="app-btn" onClick={props.onCancel}>
              Peruuta
            </button>
            <button
              className="app-btn app-btn-primary"
              disabled={!validation.ok}
              onClick={() => {
                const { startingXI, bench } = splitSquadIntoXIAndBench({
                  squad,
                  oldStartingXI: props.startingXI,
                  oldBench: props.bench,
                });
                props.onSave({ startingXI, bench });
              }}
            >
              Tallenna vaihdot
            </button>
          </div>
        </div>

        {!validation.ok && (
          <div className="app-alert" style={{ marginTop: 12 }}>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Korjaa ennen tallennusta:</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {validation.errors.map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* YOUR SQUAD */}
      <div className="app-section">
        <h3 className="app-h2">Joukkueesi ({squad.length}/15)</h3>

        {squad.length === 0 ? (
          <div className="app-muted">Ei pelaajia valittuna.</div>
        ) : (
          <div className="app-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Nimi</th>
                  <th>Pelipaikka</th>
                  <th>Joukkue</th>
                  <th style={{ textAlign: "right" }}>Arvo (M)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {squad
                  .slice()
                  .sort((a, b) => a.position.localeCompare(b.position) || b.value - a.value || a.name.localeCompare(b.name))
                  .map((p) => (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.position}</td>
                      <td>{teamsById.get(p.teamId) ?? p.teamId}</td>
                      <td style={{ textAlign: "right" }}>{p.value.toFixed(1)}</td>
                      <td style={{ width: 90 }}>
                        <button className="app-btn app-btn-danger" onClick={() => removeFromSquad(p.id)}>
                          Poista
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ALL PLAYERS */}
      <div className="app-section">
        <h3 className="app-h2">Kaikki pelaajat</h3>

        <div className="app-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th>Nimi</th>
                <th>Pelipaikka</th>
                <th>Joukkue</th>
                <th style={{ textAlign: "right" }}>Arvo (M)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {availablePlayers.map((p) => {
                const inSquad = squadIds.has(p.id);
                const disabled = !canAdd(p);
                const teamName = teamsById.get(p.teamId) ?? "";

                return (
                  <tr key={p.id} className={inSquad ? "app-row-selected" : undefined}>
                    <td>{p.name}</td>
                    <td>{p.position}</td>
                    <td>{teamName}</td>
                    <td style={{ textAlign: "right" }}>{p.value.toFixed(1)}</td>
                    <td style={{ width: 90 }}>
                      <button
                        className="app-btn app-btn-primary"
                        disabled={inSquad || disabled}
                        onClick={() => addToSquad(p)}
                        title={
                          inSquad
                            ? "Jo joukkueessa"
                            : disabled
                              ? "Ei voi lisätä (max 15 / max 3 per joukkue / budjetti)"
                              : "Lisää"
                        }
                      >
                        Lisää
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="app-muted" style={{ marginTop: 8 }}>
          Huom: Tallennuksessa joukkue jaetaan automaattisesti avaukseen (11) ja penkille (4) nykyisen avauksen formaation mukaan
          (tai 4-4-2 jos formaatiota ei voi päätellä).
        </div>
      </div>
    </div>
  );
}