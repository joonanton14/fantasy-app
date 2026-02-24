// client/src/App.tsx
import { useEffect, useState, useMemo, JSX } from "react";
import Login from "./login";
import AdminPortal from "./adminPortal";
import StartingXI, { type FormationKey, type Player, type Team } from "./StartingXI";
import { apiCall } from "./api";
import "./styles.css";
import { loadSavedTeam, saveStartingXI } from "./userTeam";
import TransfersPage from "./transferPage";

const INITIAL_BUDGET = 100;

type Fixture = { id: number; homeTeamId: number; awayTeamId: number; date: string; round?: number };
type LeaderboardRow = { username: string; total: number; last: number };

function idsToPlayersInOrder(ids: number[], playersById: Map<number, Player>): Player[] {
  const out: Player[] = [];
  for (const id of ids) {
    const p = playersById.get(id);
    if (p) out.push(p);
  }
  return out;
}

function uniqIdsFromPlayers(list: Player[]): number[] {
  const set = new Set<number>();
  for (const p of list) set.add(p.id);
  return Array.from(set);
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);

  const [leaderboard, setLeaderboard] = useState<LeaderboardRow[]>([]);
  const [loadingLb, setLoadingLb] = useState(false);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [page, setPage] = useState<"builder" | "admin">("builder");

  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);

  const playersById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);

  // saved team pieces
  const [squad, setSquad] = useState<Player[]>([]);
  const [startingXI, setStartingXI] = useState<Player[]>([]);
  const [bench, setBench] = useState<Player[]>([]);
  const [savedFormation, setSavedFormation] = useState<FormationKey>("4-4-2");

  const [error, setError] = useState<string | null>(null);

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [fixturesErr, setFixturesErr] = useState<string | null>(null);
  const [loadingFixtures, setLoadingFixtures] = useState(false);

  const [teamViewTab, setTeamViewTab] =
    useState<"startingXI" | "players" | "leaderboard" | "fixtures" | "transfers">("startingXI");

  const [filterTeamId, setFilterTeamId] = useState<number | null>(null);
  const [filterPositions, setFilterPositions] = useState<Set<Player["position"]>>(
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

  // -------------------- AUTH RESTORE --------------------
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      setError(null);

      const saved = localStorage.getItem("session");
      if (saved) {
        try {
          const { userId, userName, isAdmin } = JSON.parse(saved);
          if (!cancelled) {
            setUserId(userId ?? null);
            setUserName(userName ?? null);
            setIsAdmin(!!isAdmin);
            setIsLoggedIn(true);
            setPage(isAdmin ? "admin" : "builder");
            setAuthChecked(true);
          }
          return;
        } catch {
          localStorage.removeItem("session");
        }
      }

      try {
        const res = await apiCall("/auth/me", { method: "GET" });
        if (!res.ok) {
          if (!cancelled) {
            setIsLoggedIn(false);
            setUserId(null);
            setUserName(null);
            setIsAdmin(false);
          }
          return;
        }

        const me = await res.json();
        if (cancelled) return;

        setIsLoggedIn(true);
        setUserId(null);
        setUserName(me.name);
        setIsAdmin(!!me.isAdmin);
        setPage(me.isAdmin ? "admin" : "builder");

        localStorage.setItem("session", JSON.stringify({ userId: null, userName: me.name, isAdmin: !!me.isAdmin }));
      } catch {
        // ignore
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    }

    restore();
    return () => {
      cancelled = true;
    };
  }, []);

  // -------------------- LOAD PLAYERS + TEAMS AFTER LOGIN --------------------
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

  // -------------------- LEADERBOARD --------------------
  async function loadLeaderboard() {
    setLoadingLb(true);
    try {
      const res = await apiCall("/leaderboard", { method: "GET" });
      if (!res.ok) return;
      const data = await res.json();
      setLeaderboard((data?.rows ?? []) as LeaderboardRow[]);
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

  // -------------------- LOAD SAVED TEAM AFTER PLAYERS --------------------
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoadingSaved(true);
      try {
        const data = await loadSavedTeam();
        if (cancelled) return;

        const formation = (data?.formation ?? "4-4-2") as FormationKey;
        setSavedFormation(formation);

        const squadIds = data?.squadIds ?? [];
        const xiIds = data?.startingXIIds ?? [];
        const benchIds = data?.benchIds ?? [];

        // ✅ preserve order exactly
        const xiPlayers = idsToPlayersInOrder(xiIds, playersById);
        const benchPlayers = idsToPlayersInOrder(benchIds, playersById);

        // ✅ squad pool: prefer explicit squadIds; else derive from xi+bench
        const derivedSquadIds = uniqIdsFromPlayers([...xiPlayers, ...benchPlayers]);
        const poolIds = squadIds.length === 15 ? squadIds : derivedSquadIds;

        const squadPlayers = idsToPlayersInOrder(poolIds, playersById);

        setSquad(squadPlayers);
        setStartingXI(xiPlayers);
        setBench(benchPlayers);
      } catch {
        // ignore
      } finally {
        if (!cancelled) setLoadingSaved(false);
      }
    }

    if (isLoggedIn && players.length > 0) run();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, players, playersById]);

  function handleLoginSuccess(userId: number, userName: string, isAdmin: boolean) {
    setUserId(userId);
    setUserName(userName);
    setIsAdmin(isAdmin);
    setIsLoggedIn(true);
    setPage(isAdmin ? "admin" : "builder");
    localStorage.setItem("session", JSON.stringify({ userId, userName, isAdmin }));
  }

  async function handleLogout() {
    try {
      await apiCall("/auth/logout", { method: "POST" });
    } catch {}

    setIsLoggedIn(false);
    setUserId(null);
    setUserName(null);
    setIsAdmin(false);

    setSquad([]);
    setStartingXI([]);
    setBench([]);
    setSavedFormation("4-4-2");

    setPage("builder");
    setTeamViewTab("startingXI");
    setPlayers([]);
    setTeams([]);
    localStorage.removeItem("session");
  }

  function togglePositionFilter(pos: Player["position"]) {
    setFilterPositions((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  }

  // ✅ SAVE: StartingXI (always also save squadIds as union of xi+bench)
  const saveXI = async (payload: { startingXI: Player[]; bench: Player[]; formation?: FormationKey }) => {
    const xi = payload.startingXI;
    const b = payload.bench;
    const nextFormation = payload.formation ?? savedFormation;

    // Always derive squad from XI+bench; this fixes missing strikers permanently
    const squadIds = uniqIdsFromPlayers([...xi, ...b]);
    const squadPlayers = idsToPlayersInOrder(squadIds, playersById);

    setStartingXI(xi);
    setBench(b);
    setSquad(squadPlayers);
    setSavedFormation(nextFormation);

    await saveStartingXI({
      squadIds,
      startingXIIds: xi.map((p) => p.id),
      benchIds: b.map((p) => p.id),
      formation: nextFormation,
    });
  };

  // ✅ SAVE: TransfersPage (squad only)
  const saveSquad = async (nextSquad: Player[]) => {
    setSquad(nextSquad);

    await saveStartingXI({
      squadIds: nextSquad.map((p) => p.id),
    });
  };

  // -------------------- RENDER --------------------
  if (!authChecked) {
    return (
      <div className="app-muted" style={{ padding: 16 }}>
        Loading…
      </div>
    );
  }

  if (!isLoggedIn) return <Login onLoginSuccess={handleLoginSuccess} />;

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
                    players={players}
                    teams={teams}
                    initial={startingXI}
                    initialBench={bench}
                    initialSquad={squad}             // ✅ pool locked to squad
                    initialFormation={savedFormation}
                    budget={INITIAL_BUDGET}
                    readOnly={false}
                    onSave={(payload) => {
                      if (payload.mode !== "standard") return;
                      saveXI({
                        startingXI: payload.startingXI,
                        bench: payload.bench,
                        formation: payload.formation,
                      });
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
                    <div className="app-table-wrap">
                      <table className="app-table">
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
                    <table className="app-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Käyttäjä</th>
                          <th style={{ textAlign: "right" }}>Viime kierros</th>
                          <th style={{ textAlign: "right" }}>Yhteensä</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leaderboard.map((r, idx) => (
                          <tr key={r.username}>
                            <td>{idx + 1}</td>
                            <td>{r.username}</td>
                            <td style={{ textAlign: "right" }}>{r.last ?? 0}</td>
                            <td style={{ textAlign: "right" }}>{r.total ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              ) : (
                <>
                  {/* Players tab (unchanged, trimmed) */}
                  <div className="app-table-wrap">
                    <table className="app-table">
                      <thead>
                        <tr>
                          <th>Nimi</th>
                          <th>Pelipaikka</th>
                          <th>Joukkue</th>
                          <th>Arvo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPlayers.map((p) => (
                          <tr key={p.id}>
                            <td>{p.name}</td>
                            <td>{p.position}</td>
                            <td>{teamsById.get(p.teamId)?.name ?? p.teamId}</td>
                            <td>{p.value.toFixed(1)} M</td>
                          </tr>
                        ))}
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

  // ADMIN VIEW
  return (
    <div className="app-shell">
      <nav>
        <div className="nav-left">
          <button className={page === "admin" ? "active" : undefined} onClick={() => setPage("admin")}>
            Admin hallintapaneeli
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
        <div className="app-card">{page === "admin" && <AdminPortal />}</div>
      </main>
    </div>
  );
}