import { useEffect, useState, useMemo } from 'react';
import Login from './login';
import AdminPortal from './adminPortal';
import StartingXI from './StartingXI';
import { apiCall } from './api';
import './styles.css';
import { loadSavedTeam, saveStartingXI } from './userTeam';

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

const INITIAL_BUDGET = 100;

export default function App() {
  // -------------------- STATE --------------------
  const [authChecked, setAuthChecked] = useState(false);
  const [leaderboard, setLeaderboard] = useState<Array<{ username: string; points: number }>>([]);
  const [loadingLb, setLoadingLb] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [page, setPage] = useState<'builder' | 'admin'>('builder');

  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selected, setSelected] = useState<Player[]>([]);
  const [startingXI, setStartingXI] = useState<Player[]>([]);
  const [bench, setBench] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [teamViewTab, setTeamViewTab] = useState<'startingXI' | 'players' | 'leaderboard'>('startingXI');
  const [filterTeamId, setFilterTeamId] = useState<number | null>(null);
  const [filterPositions, setFilterPositions] = useState<Set<'GK' | 'DEF' | 'MID' | 'FWD'>>(
    new Set(['GK', 'DEF', 'MID', 'FWD'])
  );

  const [loadingSaved, setLoadingSaved] = useState(false);

  // Lock/unlock Starting XI editing
  const [xiLocked, setXiLocked] = useState(true);

  // -------------------- MEMOS --------------------
  const filteredPlayers = useMemo(() => {
    return players.filter((p) => {
      if (filterTeamId !== null && p.teamId !== filterTeamId) return false;
      if (!filterPositions.has(p.position)) return false;
      return true;
    });
  }, [players, filterTeamId, filterPositions]);

  // -------------------- AUTH RESTORE (cookie) --------------------
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      setError(null);

      // 1) Fast UI restore from localStorage (optional)
      const saved = localStorage.getItem('session');
      if (saved) {
        try {
          const { userId, userName, isAdmin } = JSON.parse(saved);
          if (!cancelled) {
            setUserId(userId ?? null);
            setUserName(userName ?? null);
            setIsAdmin(!!isAdmin);
            setIsLoggedIn(true);
            setPage(isAdmin ? 'admin' : 'builder');
            setAuthChecked(true);
          }
          return;
        } catch {
          localStorage.removeItem('session');
        }
      }

      // 2) Source of truth: cookie session
      try {
        const res = await apiCall('/auth/me', { method: 'GET' });
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
        setPage(me.isAdmin ? 'admin' : 'builder');

        localStorage.setItem('session', JSON.stringify({ userId: null, userName: me.name, isAdmin: !!me.isAdmin }));
      } catch {
        // ignore (network / first load)
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
        const [playersRes, teamsRes] = await Promise.all([apiCall('/players'), apiCall('/teams')]);
        const playersData: Player[] = await playersRes.json();
        const teamsData: Team[] = await teamsRes.json();
        if (cancelled) return;
        setPlayers(playersData);
        setTeams(teamsData);
      } catch {
        if (!cancelled) setError('Failed to load players or teams');
      }
    }

    if (isLoggedIn) load();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn]);

  useEffect(() => {
  let cancelled = false;

  async function loadLb() {
    setLoadingLb(true);
    try {
      const res = await apiCall("/leaderboard", { method: "GET" });
      if (!res.ok) return;
      const data = await res.json();
      if (!cancelled) setLeaderboard(data.rows ?? []);
    } finally {
      if (!cancelled) setLoadingLb(false);
    }
  }

  if (isLoggedIn) loadLb();
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
        const data = await loadSavedTeam(); // { startingXIIds?: number[]; benchIds?: number[] } | null
        if (cancelled) return;

        const xiIds = data?.startingXIIds ?? [];
        const benchIds = data?.benchIds ?? [];

        const xiSet = new Set(xiIds);
        const benchSet = new Set(benchIds);

        const xiPlayers = players.filter((p) => xiSet.has(p.id));
        const benchPlayers = players.filter((p) => benchSet.has(p.id));

        setStartingXI(xiPlayers);
        setBench(benchPlayers);

        setXiLocked(xiPlayers.length === 11);

        setSelected((prev) => {
          const existing = new Set(prev.map((p) => p.id));
          const merged = [...prev];
          for (const p of [...xiPlayers, ...benchPlayers]) {
            if (!existing.has(p.id)) merged.push(p);
          }
          return merged;
        });
      } catch {
        // optional
      } finally {
        if (!cancelled) setLoadingSaved(false);
      }
    }

    if (isLoggedIn && players.length > 0) run();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, players]);

  useEffect(() => {
  let cancelled = false;

  async function loadLb() {
    setLoadingLb(true);
    try {
      const res = await apiCall("/leaderboard", { method: "GET" });
      if (!res.ok) return;
      const data = await res.json();
      if (!cancelled) setLeaderboard(data.rows ?? []);
    } finally {
      if (!cancelled) setLoadingLb(false);
    }
  }

  if (isLoggedIn) loadLb();
  return () => { cancelled = true; };
}, [isLoggedIn]);

async function loadLeaderboard() {
  setLoadingLb(true);
  try {
    const res = await apiCall("/leaderboard", { method: "GET" });
    if (!res.ok) return;
    const data = await res.json();
    setLeaderboard(data.rows ?? []);
  } finally {
    setLoadingLb(false);
  }
}

  // -------------------- HELPERS --------------------
  const totalValue = () => selected.reduce((sum, p) => sum + p.value, 0);

  function handleLoginSuccess(userId: number, userName: string, isAdmin: boolean) {
    setUserId(userId);
    setUserName(userName);
    setIsAdmin(isAdmin);
    setIsLoggedIn(true);
    setPage(isAdmin ? 'admin' : 'builder');

    // keep UI fast on refresh (optional)
    localStorage.setItem('session', JSON.stringify({ userId, userName, isAdmin }));
  }

  async function handleLogout() {
    try {
      await apiCall('/auth/logout', { method: 'POST' });
    } catch {}

    setIsLoggedIn(false);
    setUserId(null);
    setUserName(null);
    setIsAdmin(false);
    setSelected([]);
    setStartingXI([]);
    setBench([]);
    setXiLocked(true);
    setPage('builder');
    setTeamViewTab('startingXI');
    setPlayers([]);
    setTeams([]);
    localStorage.removeItem('session');
  }

  function addPlayer(player: Player) {
    if (selected.some((p) => p.id === player.id)) return;
    if (selected.length >= 15) return;
    const countFromTeam = selected.filter((p) => p.teamId === player.teamId).length;
    if (countFromTeam >= 3) return;
    if (totalValue() + player.value > INITIAL_BUDGET) return;
    setSelected([...selected, player]);
  }

  function removePlayer(id: number) {
    setSelected(selected.filter((p) => p.id !== id));
  }

  function togglePositionFilter(pos: 'GK' | 'DEF' | 'MID' | 'FWD') {
    setFilterPositions((prev) => {
      const next = new Set(prev);
      if (next.has(pos)) next.delete(pos);
      else next.add(pos);
      return next;
    });
  }

  const saveXI = async (payload: { startingXI: Player[]; bench: Player[] }) => {
    const xi = payload.startingXI;
    const b = payload.bench;

    setStartingXI(xi);
    setBench(b);

    setSelected((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      const merged = [...prev];
      for (const p of [...xi, ...b]) {
        if (!ids.has(p.id)) merged.push(p);
      }
      return merged;
    });

    try {
      await saveStartingXI({
        startingXIIds: xi.map((p) => p.id),
        benchIds: b.map((p) => p.id),
      });
    } catch {}

    setTeamViewTab('startingXI');
    setXiLocked(true);
  };

  // -------------------- RENDER --------------------
  if (!authChecked) {
    return <div className="app-muted" style={{ padding: 16 }}>Loading…</div>;
  }

  if (!isLoggedIn) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  // -------------------- USER VIEW --------------------
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
                    className={`app-btn ${teamViewTab === 'startingXI' ? 'app-btn-active' : ''}`}
                    onClick={() => setTeamViewTab('startingXI')}
                  >
                    Kokoonpano
                  </button>
                  <button
                    className={`app-btn ${teamViewTab === 'players' ? 'app-btn-active' : ''}`}
                    onClick={() => setTeamViewTab('players')}
                  >
                    Pelaajat
                  </button>
                  <button
  className={`app-btn ${teamViewTab === 'leaderboard' ? 'app-btn-active' : ''}`}
  onClick={() => {
    setTeamViewTab('leaderboard');
    loadLeaderboard();
  }}
>
  Tulostaulu
</button>

                </div>
              </div>

              {teamViewTab === 'startingXI' ? (
                <div>
                  {loadingSaved && <div className="app-muted">Ladataan tallennettu joukkue…</div>}

                  {startingXI.length === 11 && xiLocked && (
                    <div className="app-actions" style={{ marginBottom: 12 }}>
                      <button className="app-btn app-btn-primary" onClick={() => setXiLocked(false)}>
                        Muokkaa avauskokoonpanoa
                      </button>
                    </div>
                  )}

                  <StartingXI
                    players={players}
                    teams={teams}
                    initial={startingXI}
                    initialBench={bench}
                    onSave={saveXI}
                    budget={INITIAL_BUDGET}
                    readOnly={startingXI.length === 11 && xiLocked}
                  />
                </div>
              ) : (
                <>
                  {selected.length === 0 ? (
                    <div className="app-muted">Et ole valinnut vielä yhtään pelaajaa.</div>
                  ) : (
                    <div className="selected-players-list">
                      <table className="app-table">
                        <thead>
                          <tr>
                            <th>Nimi</th>
                            <th>Pelipaikka</th>
                            <th>Joukkue</th>
                            <th>Arvo (M)</th>
                            <th></th>
                          </tr>
                        </thead>
                        <tbody>
                          {selected.map((p) => {
                            const teamName = teams.find((t) => t.id === p.teamId)?.name ?? '';
                            return (
                              <tr key={p.id}>
                                <td>{p.name}</td>
                                <td>{p.position}</td>
                                <td>{teamName}</td>
                                <td>{p.value.toFixed(1)}</td>
                                <td>
                                  <button className="app-btn app-btn-danger" onClick={() => removePlayer(p.id)}>
                                    Poista
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <div className="app-section">
                    <h2 className="app-h2">Suodattimet</h2>
                    <div className="filter-group">
                      <div className="filter-row">
                        <label>Joukkue:</label>
                        <select
                          value={filterTeamId ?? ''}
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
                        <label>Pelipaikat:</label>
                        <div className="position-buttons">
                          {(['GK', 'DEF', 'MID', 'FWD'] as const).map((pos) => (
                            <button
                              key={pos}
                              className={`app-btn ${filterPositions.has(pos) ? 'app-btn-active' : ''}`}
                              onClick={() => togglePositionFilter(pos)}
                              title={`${filterPositions.has(pos) ? 'Hide' : 'Show'} ${pos}`}
                            >
                              {pos}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="app-table-wrap">
                    <table className="app-table">
                      <thead>
                        <tr>
                          <th>Nimi</th>
                          <th>Pelipaikka</th>
                          <th>Joukkue</th>
                          <th>Arvo (M)</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredPlayers.map((p) => {
                          const isSelectedRow = selected.some((sel) => sel.id === p.id);
                          const sameTeamCount = selected.filter((sel) => sel.teamId === p.teamId).length;
                          const willExceedBudget = totalValue() + p.value > INITIAL_BUDGET;
                          const teamName = teams.find((t) => t.id === p.teamId)?.name ?? '';

                          return (
                            <tr key={p.id} className={isSelectedRow ? 'app-row-selected' : undefined}>
                              <td>{p.name}</td>
                              <td>{p.position}</td>
                              <td>{teamName}</td>
                              <td>{p.value.toFixed(1)}</td>
                              <td>
                                <button
                                  className="app-btn app-btn-primary"
                                  disabled={
                                    isSelectedRow || selected.length >= 15 || sameTeamCount >= 3 || willExceedBudget
                                  }
                                  onClick={() => addPlayer(p)}
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
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  // -------------------- ADMIN VIEW --------------------
  return (
    <div className="app-shell">
      <nav>
        <div className="nav-left">
          <button className={page === 'admin' ? 'active' : undefined} onClick={() => setPage('admin')}>
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
        <div className="app-card">
          {page === 'admin' && <AdminPortal />}
          {page === 'builder' && (
            <>
              <h1 className="app-h1">Veikkauliigapörssi admin</h1>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
