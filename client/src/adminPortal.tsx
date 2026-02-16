// src/adminPortal.tsx
import { useEffect, useMemo, useState } from "react";
import { apiCall } from "./api";

type Position = "GK" | "DEF" | "MID" | "FWD";

type Player = {
  id: number;
  name: string;
  position: Position;
  teamId: number;
  value: number;
};

type Team = {
  id: number;
  name: string;
};

type Fixture = {
  id: number;
  homeTeamId: number;
  awayTeamId: number;
  date: string; // ISO
};

type PlayerEventInput = {
  minutes: "0" | "1_59" | "60+";
  goals: number;
  assists: number;
  cleanSheet: boolean;
  penMissed: number;
  penSaved: number; // GK only
  yellow: number;
  red: number;
  ownGoals: number;
};

const DEFAULT_EVENTS: PlayerEventInput = {
  minutes: "0",
  goals: 0,
  assists: 0,
  cleanSheet: false,
  penMissed: 0,
  penSaved: 0,
  yellow: 0,
  red: 0,
  ownGoals: 0,
};

function toInt(v: string) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function calcPoints(pos: Position, e: PlayerEventInput): number {
  let pts = 0;

  // Minutes Played: played in game = 2pts (we keep 2pts for 1–59 and 60+)
  if (e.minutes === "1_59" || e.minutes === "60+") pts += 2;

  // Goals
  const goalPts = pos === "GK" ? 10 : pos === "DEF" ? 6 : pos === "MID" ? 5 : 4;
  pts += e.goals * goalPts;

  // Assists
  pts += e.assists * 3;

  // Clean sheets
  if (e.cleanSheet) {
    if (pos === "GK" || pos === "DEF") pts += 4;
    else if (pos === "MID") pts += 1;
  }

  // Penalties
  pts += e.penMissed * -2;
  if (pos === "GK") pts += e.penSaved * 3;

  // Discipline / misc
  pts += e.yellow * -1;
  pts += e.red * -3;
  pts += e.ownGoals * -2;

  return pts;
}

function formatFiDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fi-FI", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminPortal() {
  const [tab, setTab] = useState<"players" | "fixtures" | "points">("players");

  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);

  const [loading, setLoading] = useState(true);
  const [fixturesError, setFixturesError] = useState<string | null>(null);
  const [playersError, setPlayersError] = useState<string | null>(null);

  // Players tab: search + filters
  const [playerQ, setPlayerQ] = useState("");
  const [playerTeamId, setPlayerTeamId] = useState<number | "all">("all");
  const [playerPos, setPlayerPos] = useState<Position | "all">("all");

  // Fixtures tab: search
  const [fixtureQ, setFixtureQ] = useState("");

  // Points tab: selected fixture + editor state
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [eventsByPlayerId, setEventsByPlayerId] = useState<Record<number, PlayerEventInput>>({});
  const [manualPointsByPlayerId, setManualPointsByPlayerId] = useState<Record<number, string>>({});

  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const teamNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of teams) m.set(t.id, t.name);
    return m;
  }, [teams]);

  const fixturesById = useMemo(() => {
    const m = new Map<number, Fixture>();
    for (const f of fixtures) m.set(f.id, f);
    return m;
  }, [fixtures]);

  const selectedFixture = useMemo(() => {
    if (!selectedGameId) return null;
    return fixturesById.get(selectedGameId) ?? null;
  }, [fixturesById, selectedGameId]);

  const selectedTeams = useMemo(() => {
    if (!selectedFixture) return null;
    const home = teamNameById.get(selectedFixture.homeTeamId) ?? String(selectedFixture.homeTeamId);
    const away = teamNameById.get(selectedFixture.awayTeamId) ?? String(selectedFixture.awayTeamId);
    return { home, away };
  }, [selectedFixture, teamNameById]);

  const playersInSelectedGame = useMemo(() => {
    if (!selectedFixture) return [];
    return players
      .filter((p) => p.teamId === selectedFixture.homeTeamId || p.teamId === selectedFixture.awayTeamId)
      .sort((a, b) => {
        // GK, DEF, MID, FWD ordering-ish
        const order: Record<Position, number> = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
        const o = order[a.position] - order[b.position];
        if (o !== 0) return o;
        return a.name.localeCompare(b.name);
      });
  }, [players, selectedFixture]);

  function setPlayerEvent(pid: number, patch: Partial<PlayerEventInput>) {
    setEventsByPlayerId((prev) => ({
      ...prev,
      [pid]: { ...(prev[pid] ?? DEFAULT_EVENTS), ...patch },
    }));
  }

  // ---- initial load (players/teams/fixtures)
  useEffect(() => {
    let cancelled = false;

    async function loadAll() {
      setLoading(true);
      setPlayersError(null);
      setFixturesError(null);

      try {
        const [pRes, tRes, fRes] = await Promise.all([
          apiCall("/players", { method: "GET" }),
          apiCall("/teams", { method: "GET" }),
          apiCall("/admin/fixtures", { method: "GET" }),
        ]);

        if (!pRes.ok) throw new Error("Failed to load players");
        if (!tRes.ok) throw new Error("Failed to load teams");
        if (!fRes.ok) {
          const j = await fRes.json().catch(() => ({}));
          const msg = (j as any)?.error || "Failed to load fixtures (admin)";
          throw new Error(msg);
        }

        const p = (await pRes.json()) as Player[];
        const t = (await tRes.json()) as Team[];
        const fj = (await fRes.json()) as { fixtures: Fixture[] };

        if (cancelled) return;
        setPlayers(p);
        setTeams(t);
        setFixtures(Array.isArray(fj?.fixtures) ? fj.fixtures : []);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Load failed";
        if (!cancelled) {
          // Split message if possible
          if (msg.toLowerCase().includes("fixture")) setFixturesError(msg);
          else setPlayersError(msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadAll();
    return () => {
      cancelled = true;
    };
  }, []);

  // ---- when selecting a game, load saved totals
  useEffect(() => {
    let cancelled = false;

    async function loadPoints() {
      if (!selectedGameId) return;

      setPointsLoading(true);
      setPointsError(null);
      setSaveStatus("idle");

      try {
        const res = await apiCall(`/admin/game-points?gameId=${encodeURIComponent(String(selectedGameId))}`, {
          method: "GET",
        });

        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as any)?.error || "Failed to load points");
        }

        const j = (await res.json()) as { gameId: number; points: Record<string, number> };
        if (cancelled) return;

        const saved = j?.points ?? {};
        const manual: Record<number, string> = {};
        for (const [pidStr, pts] of Object.entries(saved)) {
          const pid = Number(pidStr);
          if (Number.isInteger(pid)) manual[pid] = String(pts);
        }

        // We only saved totals -> can't rebuild events reliably
        // So: start fresh events, and prefill Manual from saved totals.
        setEventsByPlayerId({});
        setManualPointsByPlayerId(manual);
      } catch (e) {
        if (!cancelled) setPointsError(e instanceof Error ? e.message : "Failed to load points");
      } finally {
        if (!cancelled) setPointsLoading(false);
      }
    }

    loadPoints();
    return () => {
      cancelled = true;
    };
  }, [selectedGameId]);

  async function saveGamePoints() {
    if (!selectedGameId) return;

    setSaveStatus("saving");
    setPointsError(null);

    const points: Record<string, number> = {};

    for (const p of playersInSelectedGame) {
      const ev = eventsByPlayerId[p.id] ?? DEFAULT_EVENTS;
      const autoTotal = calcPoints(p.position, ev);

      const manualStr = manualPointsByPlayerId[p.id] ?? "";
      const manualNum = manualStr.trim() === "" ? null : Number(manualStr);

      const final = manualNum != null && Number.isFinite(manualNum) ? Math.trunc(manualNum) : autoTotal;

      // Save only if non-zero (optional). If you want to save zeros too, remove this.
      if (final !== 0) points[String(p.id)] = final;
    }

    try {
      const res = await apiCall("/admin/game-points", {
        method: "POST",
        body: JSON.stringify({ gameId: selectedGameId, points }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any)?.error || "Save failed");
      }

      setSaveStatus("saved");
      window.setTimeout(() => setSaveStatus("idle"), 1200);
    } catch (e) {
      setSaveStatus("idle");
      setPointsError(e instanceof Error ? e.message : "Save failed");
    }
  }

  const filteredPlayers = useMemo(() => {
    const q = playerQ.trim().toLowerCase();
    return players
      .filter((p) => {
        if (playerTeamId !== "all" && p.teamId !== playerTeamId) return false;
        if (playerPos !== "all" && p.position !== playerPos) return false;
        if (q) {
          const teamName = teamNameById.get(p.teamId) ?? "";
          const hay = `${p.name} ${teamName} ${p.position}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [players, playerQ, playerTeamId, playerPos, teamNameById]);

  const filteredFixtures = useMemo(() => {
    const q = fixtureQ.trim().toLowerCase();
    return fixtures
      .filter((f) => {
        if (!q) return true;
        const home = teamNameById.get(f.homeTeamId) ?? String(f.homeTeamId);
        const away = teamNameById.get(f.awayTeamId) ?? String(f.awayTeamId);
        const hay = `${f.id} ${home} ${away} ${formatFiDate(f.date)}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [fixtures, fixtureQ, teamNameById]);

  const pointsSummary = useMemo(() => {
    if (!selectedFixture) return { autoSum: 0, manualCount: 0 };

    let sum = 0;
    let manualCount = 0;

    for (const p of playersInSelectedGame) {
      const ev = eventsByPlayerId[p.id] ?? DEFAULT_EVENTS;
      const autoTotal = calcPoints(p.position, ev);

      const manualStr = manualPointsByPlayerId[p.id] ?? "";
      const manualNum = manualStr.trim() === "" ? null : Number(manualStr);

      const final = manualNum != null && Number.isFinite(manualNum) ? Math.trunc(manualNum) : autoTotal;
      if (manualNum != null && Number.isFinite(manualNum)) manualCount++;
      sum += final;
    }

    return { autoSum: sum, manualCount };
  }, [selectedFixture, playersInSelectedGame, eventsByPlayerId, manualPointsByPlayerId]);

  if (loading) {
    return <div className="app-muted" style={{ padding: 16 }}>Loading admin…</div>;
  }

  return (
    <div>
      <div className="app-section-header" style={{ marginBottom: 12 }}>
        <div className="app-actions">
          <button className={`app-btn ${tab === "players" ? "app-btn-active" : ""}`} onClick={() => setTab("players")}>
            Players
          </button>
          <button className={`app-btn ${tab === "fixtures" ? "app-btn-active" : ""}`} onClick={() => setTab("fixtures")}>
            Fixtures
          </button>
          <button className={`app-btn ${tab === "points" ? "app-btn-active" : ""}`} onClick={() => setTab("points")}>
            Game points
          </button>
        </div>
      </div>

      {(playersError || fixturesError) && (
        <div className="app-alert" style={{ marginBottom: 12 }}>
          {playersError || fixturesError}
        </div>
      )}

      {tab === "players" && (
        <div className="app-card" style={{ padding: 12 }}>
          <h2 className="app-h2">Players</h2>

          <div className="filter-group" style={{ marginTop: 10 }}>
            <div className="filter-row">
              <label>Search:</label>
              <input
                className="app-btn"
                style={{ width: 260 }}
                value={playerQ}
                onChange={(e) => setPlayerQ(e.target.value)}
                placeholder="name / team / position"
              />
            </div>

            <div className="filter-row">
              <label>Team:</label>
              <select
                className="app-btn"
                value={playerTeamId === "all" ? "" : String(playerTeamId)}
                onChange={(e) => setPlayerTeamId(e.target.value ? Number(e.target.value) : "all")}
              >
                <option value="">All</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>

            <div className="filter-row">
              <label>Position:</label>
              <select
                className="app-btn"
                value={playerPos === "all" ? "" : playerPos}
                onChange={(e) => setPlayerPos(e.target.value ? (e.target.value as any) : "all")}
              >
                <option value="">All</option>
                <option value="GK">GK</option>
                <option value="DEF">DEF</option>
                <option value="MID">MID</option>
                <option value="FWD">FWD</option>
              </select>
            </div>
          </div>

          <div className="app-table-wrap" style={{ marginTop: 12 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Team</th>
                  <th>Pos</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlayers.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{teamNameById.get(p.teamId) ?? ""}</td>
                    <td>{p.position}</td>
                    <td>{p.value.toFixed(1)} M</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "fixtures" && (
        <div className="app-card" style={{ padding: 12 }}>
          <h2 className="app-h2">Fixtures</h2>

          <div className="filter-row" style={{ marginTop: 10 }}>
            <label>Search:</label>
            <input
              className="app-btn"
              style={{ width: 340 }}
              value={fixtureQ}
              onChange={(e) => setFixtureQ(e.target.value)}
              placeholder="team / date / id"
            />
          </div>

          <div className="app-table-wrap" style={{ marginTop: 12 }}>
            <table className="app-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Date</th>
                  <th>Match</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredFixtures.map((f) => {
                  const home = teamNameById.get(f.homeTeamId) ?? String(f.homeTeamId);
                  const away = teamNameById.get(f.awayTeamId) ?? String(f.awayTeamId);
                  const isSel = selectedGameId === f.id;

                  return (
                    <tr key={f.id} className={isSel ? "app-row-selected" : undefined}>
                      <td>{f.id}</td>
                      <td>{formatFiDate(f.date)}</td>
                      <td>{home} – {away}</td>
                      <td>
                        <button
                          className="app-btn app-btn-primary"
                          onClick={() => {
                            setSelectedGameId(f.id);
                            setTab("points");
                          }}
                        >
                          Add points
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "points" && (
        <div className="app-card" style={{ padding: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
            <div>
              <h2 className="app-h2">Game points</h2>
              <div className="app-muted">
                Select a fixture, then fill events. Total is calculated automatically.
                You can override totals in “Manual” if needed.
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <label className="app-muted">Fixture:</label>
              <select
                className="app-btn"
                value={selectedGameId ?? ""}
                onChange={(e) => setSelectedGameId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Select…</option>
                {fixtures
                  .slice()
                  .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                  .map((f) => {
                    const home = teamNameById.get(f.homeTeamId) ?? String(f.homeTeamId);
                    const away = teamNameById.get(f.awayTeamId) ?? String(f.awayTeamId);
                    return (
                      <option key={f.id} value={f.id}>
                        #{f.id} {home}–{away} ({formatFiDate(f.date)})
                      </option>
                    );
                  })}
              </select>

              <button
                className="app-btn app-btn-primary"
                onClick={saveGamePoints}
                disabled={!selectedGameId || pointsLoading || saveStatus === "saving"}
                title={!selectedGameId ? "Select fixture first" : undefined}
              >
                {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved ✓" : "Save"}
              </button>
            </div>
          </div>

          {pointsError && <div className="app-alert" style={{ marginTop: 12 }}>{pointsError}</div>}

          {!selectedFixture ? (
            <div className="app-muted" style={{ marginTop: 12 }}>
              Pick a fixture from the dropdown (or from the Fixtures tab).
            </div>
          ) : (
            <>
              <div style={{ marginTop: 10 }} className="app-muted">
                <b>
                  #{selectedFixture.id} {selectedTeams?.home} – {selectedTeams?.away}
                </b>{" "}
                • {formatFiDate(selectedFixture.date)} • Players: {playersInSelectedGame.length} • Manual overrides:{" "}
                {pointsSummary.manualCount} • Sum of saved totals: <b>{pointsSummary.autoSum}</b>
              </div>

              {pointsLoading ? (
                <div className="app-muted" style={{ marginTop: 12 }}>Loading saved points…</div>
              ) : (
                <div className="app-table-wrap" style={{ marginTop: 12 }}>
                  <table className="app-table">
                    <thead>
                      <tr>
                        <th>Pelaaja</th>
                        <th>Joukkue</th>
                        <th>Pos</th>
                        <th>Min</th>
                        <th>G</th>
                        <th>A</th>
                        <th>CS</th>
                        <th>PM</th>
                        <th>PS</th>
                        <th>Y</th>
                        <th>R</th>
                        <th>OG</th>
                        <th>Total</th>
                        <th style={{ width: 130 }}>Manual</th>
                      </tr>
                    </thead>
                    <tbody>
                      {playersInSelectedGame.map((p) => {
                        const tName = teamNameById.get(p.teamId) ?? "";
                        const ev = eventsByPlayerId[p.id] ?? DEFAULT_EVENTS;

                        const autoTotal = calcPoints(p.position, ev);

                        const manualStr = manualPointsByPlayerId[p.id] ?? "";
                        const manualNum = manualStr.trim() === "" ? null : Number(manualStr);

                        const finalToShow =
                          manualNum != null && Number.isFinite(manualNum) ? Math.trunc(manualNum) : autoTotal;

                        return (
                          <tr key={p.id}>
                            <td>{p.name}</td>
                            <td>{tName}</td>
                            <td>{p.position}</td>

                            <td>
                              <select
                                className="app-btn"
                                value={ev.minutes}
                                onChange={(e) => setPlayerEvent(p.id, { minutes: e.target.value as any })}
                              >
                                <option value="0">0</option>
                                <option value="1_59">1–59</option>
                                <option value="60+">60+</option>
                              </select>
                            </td>

                            <td>
                              <input
                                className="app-btn"
                                style={{ width: 58 }}
                                inputMode="numeric"
                                value={String(ev.goals)}
                                onChange={(e) => setPlayerEvent(p.id, { goals: toInt(e.target.value) })}
                              />
                            </td>

                            <td>
                              <input
                                className="app-btn"
                                style={{ width: 58 }}
                                inputMode="numeric"
                                value={String(ev.assists)}
                                onChange={(e) => setPlayerEvent(p.id, { assists: toInt(e.target.value) })}
                              />
                            </td>

                            <td style={{ textAlign: "center" }}>
                              <input
                                type="checkbox"
                                checked={ev.cleanSheet}
                                onChange={(e) => setPlayerEvent(p.id, { cleanSheet: e.target.checked })}
                              />
                            </td>

                            <td>
                              <input
                                className="app-btn"
                                style={{ width: 58 }}
                                inputMode="numeric"
                                value={String(ev.penMissed)}
                                onChange={(e) => setPlayerEvent(p.id, { penMissed: toInt(e.target.value) })}
                              />
                            </td>

                            <td>
                              <input
                                className="app-btn"
                                style={{ width: 58 }}
                                inputMode="numeric"
                                value={String(ev.penSaved)}
                                disabled={p.position !== "GK"}
                                title={p.position !== "GK" ? "Only GK" : undefined}
                                onChange={(e) => setPlayerEvent(p.id, { penSaved: toInt(e.target.value) })}
                              />
                            </td>

                            <td>
                              <input
                                className="app-btn"
                                style={{ width: 58 }}
                                inputMode="numeric"
                                value={String(ev.yellow)}
                                onChange={(e) => setPlayerEvent(p.id, { yellow: toInt(e.target.value) })}
                              />
                            </td>

                            <td>
                              <input
                                className="app-btn"
                                style={{ width: 58 }}
                                inputMode="numeric"
                                value={String(ev.red)}
                                onChange={(e) => setPlayerEvent(p.id, { red: toInt(e.target.value) })}
                              />
                            </td>

                            <td>
                              <input
                                className="app-btn"
                                style={{ width: 58 }}
                                inputMode="numeric"
                                value={String(ev.ownGoals)}
                                onChange={(e) => setPlayerEvent(p.id, { ownGoals: toInt(e.target.value) })}
                              />
                            </td>

                            <td>
                              <b>{finalToShow}</b>{" "}
                              {manualNum == null ? <span className="app-muted">(auto)</span> : <span className="app-muted">(manual)</span>}
                            </td>

                            <td>
                              <input
                                className="app-btn"
                                style={{ width: "100%" }}
                                inputMode="numeric"
                                placeholder="override"
                                value={manualStr}
                                onChange={(e) =>
                                  setManualPointsByPlayerId((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>

                  <div className="app-muted" style={{ marginTop: 10 }}>
                    Tip: if you want the dropdown selections to persist when you reopen the same fixture, we should store
                    the <i>breakdown</i> (events) to Redis as well, not just total points.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
