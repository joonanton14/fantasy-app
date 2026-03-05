// App.tsx
import { useEffect, useMemo, useState, JSX } from "react";
import Login from "./login";
import AdminPortal from "./adminPortal";
import StartingXI, { type FormationKey } from "./StartingXI";
import { apiCall } from "./api";
import "./styles.css";
import { loadSavedTeam, saveStartingXI } from "./userTeam";
import TransfersPage from "./transferPage";

interface Player {
  id: number;
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  teamId: number;
  value: number;
}

interface Team {
  id: number;
  name: string;
}

type SavedTeamData = {
  formation?: FormationKey;
  squadIds?: number[];
  startingXIIds?: number[];
  benchIds?: number[];
};

const INITIAL_BUDGET = 100;

export default function App() {
  // -------------------- STATE --------------------
  const [authChecked, setAuthChecked] = useState(false);

  type LeaderboardRow = { username: string; total: number; last: number };
  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loadingLb, setLoadingLb] = useState(false);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [page, setPage] = useState<"builder" | "admin">("builder");

  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const [selected, setSelected] = useState<Player[]>([]);
  const [squad, setSquad] = useState<Player[]>([]);
  const [startingXI, setStartingXI] = useState<Player[]>([]);
  const [bench, setBench] = useState<Player[]>([]);
  const [savedFormation, setSavedFormation] = useState<FormationKey>("4-4-2");

  const [error, setError] = useState<string | null>(null);

  type Fixture = { id: number; homeTeamId: number; awayTeamId: number; date: string; round?: number };
  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [fixturesErr, setFixturesErr] = useState<string | null>(null);
  const [loadingFixtures, setLoadingFixtures] = useState(false);

  const [teamViewTab, setTeamViewTab] =
    useState<"startingXI" | "players" | "leaderboard" | "fixtures" | "transfers">("startingXI");

  const [filterTeamId, setFilterTeamId] = useState<number | null>(null);
  const [filterPositions, setFilterPositions] = useState<Set<"GK" | "DEF" | "MID" | "FWD">>(
    new Set(["GK", "DEF", "MID", "FWD"])
  );

  const [loadingSaved, setLoadingSaved] = useState(false);

  type PlayerSort =
    | "name_asc"
    | "name_desc"
    | "team_asc"
    | "team_desc"
    | "pos_asc"
    | "value_desc"
    | "value_asc"
    | "id_desc"
    | "id_asc";

  const [playerSort, setPlayerSort] = useState<PlayerSort>("value_desc");

  const filteredPlayers = useMemo(() => {
    const arr = players.filter((p) => {
      if (filterTeamId !== null && p.teamId !== filterTeamId) return false;
      if (!filterPositions.has(p.position)) return false;
      return true;
    });

    const teamName = (teamId: number) => teamsById.get(teamId)?.name ?? "";

    arr.sort((a, b) => {
      switch (playerSort) {
        case "name_asc":
          return a.name.localeCompare(b.name);
        case "name_desc":
          return b.name.localeCompare(a.name);

        case "team_asc":
          return teamName(a.teamId).localeCompare(teamName(b.teamId)) || a.name.localeCompare(b.name);
        case "team_desc":
          return teamName(b.teamId).localeCompare(teamName(a.teamId)) || a.name.localeCompare(b.name);

        case "pos_asc":
          return a.position.localeCompare(b.position) || a.name.localeCompare(b.name);

        case "value_desc":
          return b.value - a.value || a.name.localeCompare(b.name);
        case "value_asc":
          return a.value - b.value || a.name.localeCompare(b.name);

        case "id_desc":
          return b.id - a.id;
        case "id_asc":
          return a.id - b.id;

        default:
          return 0;
      }
    });

    return arr;
  }, [players, filterTeamId, filterPositions, playerSort, teamsById]);

useEffect(() => {
  let cancelled = false;

  async function bootstrap() {
    setError(null);

    // Optional: quick UI hydration from localStorage (does NOT decide auth)
    const saved = localStorage.getItem("session");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!cancelled) {
          setUserName(parsed?.userName ?? null);
          setIsAdmin(!!parsed?.isAdmin);
        }
      } catch {
        localStorage.removeItem("session");
      }
    }

    try {
      // 1) Verify server session (cookie)
      const meRes = await apiCall("/auth/me", { method: "GET" });
      if (!meRes.ok) {
        // don't “force logout” here if you don't want—just show login screen as not logged in
        if (!cancelled) {
          setIsLoggedIn(false);
          setAuthChecked(true);
        }
        return;
      }

      const me = await meRes.json();
      if (cancelled) return;

      setIsLoggedIn(true);
      setUserId(null); // /auth/me doesn't include id (fine)
      setUserName(me.name ?? null);
      setIsAdmin(!!me.isAdmin);
      setPage(me.isAdmin ? "admin" : "builder");

      localStorage.setItem(
        "session",
        JSON.stringify({ userId: null, userName: me.name, isAdmin: !!me.isAdmin })
      );

      // 2) Load base data (players, teams) + saved team
      const [playersRes, teamsRes, savedTeam] = await Promise.all([
        apiCall("/players", { method: "GET" }),
        apiCall("/teams", { method: "GET" }),
        loadSavedTeam(), // GET /user-team (cookie-based)
      ]);

      if (cancelled) return;

      const playersData: Player[] = await playersRes.json();
      const teamsData: Team[] = await teamsRes.json();
      setPlayers(playersData);
      setTeams(teamsData);

      // 3) Apply saved team -> state
      const data = (savedTeam ?? null) as SavedTeamData | null;
      const byId = new Map(playersData.map((p) => [p.id, p] as const));
      const mapIds = (ids: number[]) => ids.map((id) => byId.get(id)).filter(Boolean) as Player[];

      const formation = (data?.formation ?? "4-4-2") as FormationKey;
      setSavedFormation(formation);

      const squadIds = data?.squadIds ?? [];
      const xiIds = data?.startingXIIds ?? [];
      const benchIds = data?.benchIds ?? [];

      const squadPlayers = mapIds(squadIds);
      const xiPlayers = mapIds(xiIds);
      const benchPlayers = mapIds(benchIds);

      const derivedIds = Array.from(new Set([...xiIds, ...benchIds]));
      const derivedPlayers = mapIds(derivedIds);

      setSquad(squadPlayers.length ? squadPlayers : derivedPlayers);
      setStartingXI(xiPlayers);
      setBench(benchPlayers);

      setSelected((prev) => {
        const existing = new Set(prev.map((p) => p.id));
        const merged = [...prev];
        for (const p of [...(squadPlayers.length ? squadPlayers : derivedPlayers)]) {
          if (!existing.has(p.id)) merged.push(p);
        }
        return merged;
      });
    } catch (e) {
      if (!cancelled) {
        setError("Alustus epäonnistui. Päivitä sivu tai kirjaudu uudelleen.");
        // keep whatever UI state you had; no forced logout
      }
    } finally {
      if (!cancelled) setAuthChecked(true);
    }
  }

  bootstrap();
  return () => {
    cancelled = true;
  };
}, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setError(null);
      try {
        const [playersRes, teamsRes] = await Promise.all([apiCall("/players"), apiCall("/teams")]);
        const playersData: Player[] = await playersRes.json();
        const teamsData: Team[] = await teamsRes.json();
        if (cancelled) return;
        setPlayers(playersData);
        setTeams(teamsData);
      } catch {
        if (!cancelled) setError("Failed to load players or teams");
      }
    }

    if (isLoggedIn) load();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoadingSaved(true);
      try {
        const data = (await loadSavedTeam()) as SavedTeamData | null;
        if (cancelled) return;

        const byId = new Map(players.map((p) => [p.id, p]));
        const mapIds = (ids: number[]) => ids.map((id) => byId.get(id)).filter(Boolean) as Player[];

        const formation = (data?.formation ?? "4-4-2") as FormationKey;
        setSavedFormation(formation);

        const squadIds = data?.squadIds ?? [];
        const xiIds = data?.startingXIIds ?? [];
        const benchIds = data?.benchIds ?? [];

        const squadPlayers = mapIds(squadIds);
        const xiPlayers = mapIds(xiIds);
        const benchPlayers = mapIds(benchIds);

        const derivedIds = Array.from(new Set([...xiIds, ...benchIds]));
        const derivedPlayers = mapIds(derivedIds);

        setSquad(squadPlayers.length ? squadPlayers : derivedPlayers);
        setStartingXI(xiPlayers);
        setBench(benchPlayers);

        setSelected((prev) => {
          const existing = new Set(prev.map((p) => p.id));
          const merged = [...prev];
          for (const p of [...(squadPlayers.length ? squadPlayers : derivedPlayers)]) {
            if (!existing.has(p.id)) merged.push(p);
          }
          return merged;
        });
      } catch {
      } finally {
        if (!cancelled) setLoadingSaved(false);
      }
    }

    if (isLoggedIn && players.length > 0) run();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, players]);

  async function loadFixtures() {
    setLoadingFixtures(true);
    setFixturesErr(null);
    try {
      const res = await apiCall("/admin/fixtures", { method: "GET" });
      if (!res.ok) throw new Error("Failed to load fixtures");
      const json = await res.json();
      setFixtures((json.fixtures ?? []) as Fixture[]);
    } catch (e) {
      setFixturesErr(e instanceof Error ? e.message : "Failed to load fixtures");
    } finally {
      setLoadingFixtures(false);
    }
  }

  async function loadLeaderboard() {
    setLoadingLb(true);
    try {
      const res = await apiCall("/leaderboard", { method: "GET" });
      if (!res.ok) return;
      const data = await res.json();
      const rows = (data?.rows ?? []) as LeaderboardRow[];
      setLeaderboard(rows);
      saveCurrentRanks(rows);
    } finally {
      setLoadingLb(false);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoadingLb(true);
      try {
        const res = await apiCall("/leaderboard", { method: "GET" });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setLeaderboard((data?.rows ?? []) as LeaderboardRow[]);
      } finally {
        if (!cancelled) setLoadingLb(false);
      }
    }

    if (isLoggedIn) run();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  function handleLoginSuccess(userId: number, userName: string, isAdmin: boolean) {
    setUserId(userId);
    setUserName(userName);
    setIsAdmin(isAdmin);
    setIsLoggedIn(true);
    setPage(isAdmin ? "admin" : "builder");

    // only store if userId looks valid
    if (Number.isFinite(userId) && userId > 0) {
      localStorage.setItem("session", JSON.stringify({ userId, userName, isAdmin }));
    }
  }

  async function handleLogout() {
    try {
      await apiCall("/auth/logout", { method: "POST" });
    } catch { }

    setIsLoggedIn(false);
    setUserId(null);
    setUserName(null);
    setIsAdmin(false);

    setSelected([]);
    setSquad([]);
    setStartingXI([]);
    setBench([]);

    setPage("builder");
    setTeamViewTab("startingXI");
    setPlayers([]);
    setTeams([]);
    localStorage.removeItem("session");
  }

  function rankDiffSymbol(username: string, currentRank: number): "up" | "down" | "same" | "new" {
    const key = "lb_prev_ranks";
    let prev: Record<string, number> = {};
    try {
      prev = JSON.parse(localStorage.getItem(key) || "{}");
    } catch {
      prev = {};
    }

    const prevRank = prev[username];
    if (typeof prevRank !== "number") return "new";
    if (currentRank < prevRank) return "up";
    if (currentRank > prevRank) return "down";
    return "same";
  }

  function saveCurrentRanks(rows: Array<{ username: string }>) {
    const key = "lb_prev_ranks";
    const next: Record<string, number> = {};
    rows.forEach((r, i) => (next[r.username] = i + 1));
    localStorage.setItem(key, JSON.stringify(next));
  }

  function togglePositionFilter(pos: "GK" | "DEF" | "MID" | "FWD") {
    const ALL = ["GK", "DEF", "MID", "FWD"] as const;

    setFilterPositions((prev) => {
      const isOnlyThis = prev.size === 1 && prev.has(pos);

      // If already filtering only this position -> reset to all
      if (isOnlyThis) return new Set(ALL);

      // Otherwise -> filter to only this position
      return new Set([pos]);
    });
  }

  async function saveSquad(nextSquad: Player[]) {
    setSquad(nextSquad);
    await saveStartingXI({
      squadIds: nextSquad.map((p) => p.id),
    } as any);
  }

  const saveXI = async (payload: { startingXI: Player[]; bench: Player[]; formation: FormationKey }) => {
    const xi = payload.startingXI;
    const b = payload.bench;

    setStartingXI(xi);
    setBench(b);
    setSavedFormation(payload.formation);

    const squadIds =
      squad.length === 15
        ? squad.map((p) => p.id)
        : Array.from(new Set([...xi.map((p) => p.id), ...b.map((p) => p.id)]));

    await saveStartingXI({
      formation: payload.formation,
      squadIds,
      startingXIIds: xi.map((p) => p.id),
      benchIds: b.map((p) => p.id),
    } as any);
  };

  if (!authChecked) {
    return (
      <div className="app-muted" style={{ padding: 16 }}>
        Ladataan…
      </div>
    );
  }

  if (!isLoggedIn) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  if (!isAdmin) {
    return (
      <div className="app-shell">
        <header className="app-topbar">
          <div className="app-title">Veikkausliigapörssi</div>
          <div className="app-user">
            <span className="app-user-name">Tervehdys {userName}</span>
            <button onClick={handleLogout} className="app-btn app-btn-danger">
              Kirjaudu ulos
            </button>
          </div>
        </header>

        <main className="app-main">
          <div className="app-card">
            {error && <div className="app-alert">{error}</div>}

            <div className="app-section">
              <div className="app-section-header">
                <div className="app-actions">
                  <button
                    className={`app-btn ${teamViewTab === "startingXI" ? "app-btn-active" : ""}`}
                    onClick={() => setTeamViewTab("startingXI")}
                  >
                    Kokoonpano
                  </button>

                  <button
                    className={`app-btn ${teamViewTab === "players" ? "app-btn-active" : ""}`}
                    onClick={() => setTeamViewTab("players")}
                  >
                    Pelaajat
                  </button>

                  <button
                    className={`app-btn ${teamViewTab === "leaderboard" ? "app-btn-active" : ""}`}
                    onClick={() => {
                      setTeamViewTab("leaderboard");
                      loadLeaderboard();
                    }}
                  >
                    Tulostaulu
                  </button>

                  <button
                    className={`app-btn ${teamViewTab === "fixtures" ? "app-btn-active" : ""}`}
                    onClick={() => {
                      setTeamViewTab("fixtures");
                      loadFixtures();
                    }}
                  >
                    Ottelut
                  </button>

                  <button className="app-btn app-btn-primary" onClick={() => setTeamViewTab("transfers")}>
                    Vaihdot
                  </button>
                </div>
              </div>

              {teamViewTab === "transfers" ? (
                <TransfersPage
                  players={players}
                  teams={teams}
                  squad={squad}
                  budget={INITIAL_BUDGET}
                  onCancel={() => setTeamViewTab("startingXI")}
                  onSave={async ({ squad }) => {
                    await saveSquad(squad);
                    setTeamViewTab("startingXI");
                  }}
                />
              ) : teamViewTab === "startingXI" ? (
                <div>
                  {loadingSaved && <div className="app-muted">Ladataan tallennettu joukkue…</div>}

                  <StartingXI
                    teams={teams}
                    squad={squad}
                    initialXI={startingXI}
                    initialBench={bench}
                    initialFormation={savedFormation}
                    budget={INITIAL_BUDGET}
                    readOnly={false}
                    onSave={async (p) => {
                      await saveXI({ formation: p.formation, startingXI: p.startingXI, bench: p.bench });
                    }}
                  />
                </div>
              ) : teamViewTab === "fixtures" ? (
                <div>
                  <h2 className="app-h2">Ottelut</h2>

                  {fixturesErr && <div className="app-alert">{fixturesErr}</div>}

                  {loadingFixtures ? (
                    <div className="app-muted">Ladataan…</div>
                  ) : fixtures.length === 0 ? (
                    <div className="app-muted">Ei otteluita vielä.</div>
                  ) : (
                    <div className="app-table-wrap app-table-wrap--fx">
                      <table className="app-table app-table--fx">
                        <tbody>
                          {(() => {
                            const sorted = fixtures
                              .slice()
                              .sort((a, b) => (a.round ?? 999) - (b.round ?? 999) || a.id - b.id);

                            let lastRound: number | undefined;

                            return sorted.flatMap((f) => {
                              const out: JSX.Element[] = [];

                              if (f.round !== undefined && f.round !== lastRound) {
                                lastRound = f.round;
                                out.push(
                                  <tr key={`round-${f.round}`}>
                                    <td colSpan={4} style={{ fontWeight: 700 }}>
                                      Kierros {f.round}
                                    </td>
                                  </tr>
                                );
                              }

                              out.push(
                                <tr key={f.id}>
                                  <td>{f.round ?? "-"}</td>
                                  <td>{f.id}</td>
                                  <td>
                                    {teamsById.get(f.homeTeamId)?.name ?? f.homeTeamId} vs{" "}
                                    {teamsById.get(f.awayTeamId)?.name ?? f.awayTeamId}
                                  </td>
                                  <td>
                                    {new Date(f.date).toLocaleString("fi-FI", {
                                      year: "numeric",
                                      month: "2-digit",
                                      day: "2-digit",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </td>
                                </tr>
                              );

                              return out;
                            });
                          })()}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : teamViewTab === "leaderboard" ? (
                <div>
                  <h2 className="app-h2">Tulostaulu</h2>

                  {loadingLb ? (
                    <div className="app-muted">Ladataan…</div>
                  ) : leaderboard.length === 0 ? (
                    <div className="app-muted">Ei dataa vielä.</div>
                  ) : (
                    <div className="app-table-wrap app-table-wrap--lb">
                      <table className="app-table app-table--lb">
                        <thead>
                          <tr>
                            <th></th>
                            <th>#</th>
                            <th>Käyttäjä</th>
                            <th style={{ textAlign: "right" }}>Viime kierros</th>
                            <th style={{ textAlign: "right" }}>Yhteensä</th>
                          </tr>
                        </thead>
                        <tbody>
                          {leaderboard.map((r, idx) => {
                            const rank = idx + 1;
                            const trend = rankDiffSymbol(r.username, rank);

                            const icon =
                              trend === "up" ? "▲" : trend === "down" ? "▼" : trend === "same" ? "•" : "★";

                            const title =
                              trend === "up"
                                ? "Noussut"
                                : trend === "down"
                                  ? "Laskenut"
                                  : trend === "same"
                                    ? "Ei muutosta"
                                    : "Uusi";

                            return (
                              <tr key={r.username}>
                                <td title={title} style={{ width: 28, textAlign: "center", opacity: 0.85 }}>
                                  {icon}
                                </td>
                                <td>{rank}</td>
                                <td>{r.username}</td>
                                <td style={{ textAlign: "right" }}>{r.last ?? 0}</td>
                                <td style={{ textAlign: "right" }}>{r.total ?? 0}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className="app-section" style={{ marginBottom: 12 }}>
                    <h2 className="app-h2">Suodattimet</h2>

                    <div className="filter-group">
                      <div className="filter-row">
                        <label>Joukkue:</label>
                        <select
                          value={filterTeamId ?? ""}
                          onChange={(e) => setFilterTeamId(e.target.value ? Number(e.target.value) : null)}
                          className="app-btn"
                        >
                          <option value="">Kaikki joukkueet</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="filter-row">
                        <label>Lajittelu:</label>
                        <select
                          value={playerSort}
                          onChange={(e) => setPlayerSort(e.target.value as PlayerSort)}
                          className="app-btn"
                        >
                          <option value="value_desc">Arvo (kallein→ halvin)</option>
                          <option value="value_asc">Arvo (halvin → kallein)</option>
                          <option value="name_asc">Nimi (A →)</option>
                          <option value="team_asc">Joukkue (A →)</option>
                          <option value="pos_asc">Pelipaikka</option>
                          <option value="id_desc">Uusimmat</option>
                          <option value="id_asc">Vanhimmat</option>
                        </select>
                      </div>

                      <div className="filter-row">
                        <label>Pelipaikat:</label>
                        <div className="position-buttons">
                          {(["GK", "DEF", "MID", "FWD"] as const).map((pos) => (
                            <button
                              key={pos}
                              className={`app-btn ${filterPositions.has(pos) ? "app-btn-active" : ""}`}
                              onClick={() => togglePositionFilter(pos)}
                            >
                              {pos}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="app-table-wrap app-table-wrap--players">
                    <table className="app-table app-table--players">
                      <thead>
                        <tr>
                          <th>Nimi</th>
                          <th>Pelipaikka</th>
                          <th>Joukkue</th>
                          <th>Arvo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPlayers.map((p) => {
                          const teamName = teamsById.get(p.teamId)?.name ?? "";
                          return (
                            <tr key={p.id}>
                              <td>{p.name}</td>
                              <td>{p.position}</td>
                              <td>{teamName}</td>
                              <td>{p.value.toFixed(1)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <nav>
        <div className="nav-left">
          <button className={page === "admin" ? "active" : undefined} onClick={() => setPage("admin")}>
            Hallintapaneeli
          </button>
        </div>
        <div className="nav-right">
          <span className="user-info">Morjes, {userName}!</span>
          <button onClick={handleLogout} className="logout-button">
            Kirjaudu ulos
          </button>
        </div>
      </nav>

      <main className="app-main">
        <div className="app-card">
          {page === "admin" && <AdminPortal />}
          {page === "builder" && (
            <>
              <h1 className="app-h1">Veikkauliigapörssi admin</h1>
            </>
          )}
        </div>
      </main>
    </div>
  );
}