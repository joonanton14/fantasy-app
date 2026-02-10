import { useEffect, useState } from 'react';
import Login from './login';
import AdminPortal from './adminPortal';
import StartingXI from './StartingXI';
import { apiCall } from './api';
import './styles.css';

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
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState<number | null>(null);
  const [userName, setUserName] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [page, setPage] = useState<'builder' | 'admin'>('builder');

  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selected, setSelected] = useState<Player[]>([]);
  const [startingXI, setStartingXI] = useState<Player[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [teamViewTab, setTeamViewTab] = useState<'startingXI' | 'team' | 'players'>('startingXI');
  const [filterTeamId, setFilterTeamId] = useState<number | null>(null);
  const [filterPositions, setFilterPositions] = useState<Set<'GK' | 'DEF' | 'MID' | 'FWD'>>(
    new Set(['GK', 'DEF', 'MID', 'FWD'])
  );

  // Restore session from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem('session');
    if (saved) {
      try {
        const { userId, userName, isAdmin } = JSON.parse(saved);
        setUserId(userId);
        setUserName(userName);
        setIsAdmin(isAdmin);
        setIsLoggedIn(true);
        setPage(isAdmin ? 'admin' : 'builder');
      } catch {
        localStorage.removeItem('session');
      }
    }
  }, []);

  useEffect(() => {
    async function load() {
      try {
        const [playersRes, teamsRes] = await Promise.all([apiCall('/players'), apiCall('/teams')]);
        const playersData: Player[] = await playersRes.json();
        const teamsData: Team[] = await teamsRes.json();
        setPlayers(playersData);
        setTeams(teamsData);
      } catch {
        setError('Failed to load players or teams');
      }
    }
    if (isLoggedIn) load();
  }, [isLoggedIn]);

  function handleLoginSuccess(userId: number, userName: string, isAdmin: boolean) {
    setUserId(userId);
    setUserName(userName);
    setIsAdmin(isAdmin);
    setIsLoggedIn(true);
    setPage(isAdmin ? 'admin' : 'builder');
    // Save session to localStorage
    localStorage.setItem('session', JSON.stringify({ userId, userName, isAdmin }));
  }

  function handleLogout() {
    setIsLoggedIn(false);
    setUserId(null);
    setUserName(null);
    setIsAdmin(false);
    setSelected([]);
    setPage('builder');
    // Clear session from localStorage
    localStorage.removeItem('session');
  }

  if (!isLoggedIn) {
    return <Login onLoginSuccess={handleLoginSuccess} />;
  }

  const totalValue = () => selected.reduce((sum, p) => sum + p.value, 0);

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
      if (next.has(pos)) {
        next.delete(pos);
      } else {
        next.add(pos);
      }
      return next;
    });
  }

  const filteredPlayers = players.filter((p) => {
    if (filterTeamId !== null && p.teamId !== filterTeamId) return false;
    if (!filterPositions.has(p.position)) return false;
    return true;
  });

  const saveXI = (xi: Player[]) => {
    setStartingXI(xi);
    setSelected((prev) => {
      const ids = new Set(prev.map((p) => p.id));
      return [...prev, ...xi.filter((p) => !ids.has(p.id))];
    });
    setTeamViewTab('team');
  };

  // -------------------- USER VIEW --------------------
  if (!isAdmin) {
    return (
      <div className="app-shell">
        <header className="app-topbar">
          <div className="app-title">Veikkausliigapörssi</div>
          <div className="app-user">
            <span className="app-user-name">Welcome, {userName}</span>
            <button onClick={handleLogout} className="app-btn app-btn-danger">
              Logout
            </button>
          </div>
        </header>

        <main className="app-main">
          <div className="app-card">
            <h1 className="app-h1">Team Builder</h1>

            {error && <div className="app-alert">{error}</div>}

            <div className="app-section">
              <div className="app-section-header">
                <h2 className="app-h2">
                  Squad ({selected.length}/15) — Budget: {totalValue().toFixed(1)} / {INITIAL_BUDGET}
                </h2>

                <div className="app-actions">
                  <button
                    className={`app-btn ${teamViewTab === 'startingXI' ? 'app-btn-active' : ''}`}
                    onClick={() => setTeamViewTab('startingXI')}
                  >
                    Starting XI
                  </button>
                  <button
                    className={`app-btn ${teamViewTab === 'team' ? 'app-btn-active' : ''}`}
                    onClick={() => setTeamViewTab('team')}
                  >
                    Team
                  </button>
                  <button
                    className={`app-btn ${teamViewTab === 'players' ? 'app-btn-active' : ''}`}
                    onClick={() => setTeamViewTab('players')}
                  >
                    Players
                  </button>
                </div>
              </div>

              {teamViewTab === 'startingXI' ? (
                <div>
                  <StartingXI players={players} teams={teams} initial={startingXI} onSave={saveXI} budget={INITIAL_BUDGET} />
                </div>
              ) : teamViewTab === 'team' ? (
                <>
                  {selected.length === 0 ? (
                    <div className="app-muted">No players selected yet.</div>
                  ) : (
                    <>
                      <h2 className="app-h2">Your Squad</h2>
                      <ul className="app-list">
                        {selected.map((p) => (
                          <li key={p.id} className="app-list-item">
                            <div className="app-list-main">
                              <div className="app-list-title">{p.name}</div>
                              <div className="app-list-sub">
                                {p.position} — {teams.find((t) => t.id === p.teamId)?.name} — {p.value.toFixed(1)} M
                              </div>
                            </div>
                            <button className="app-btn app-btn-danger" onClick={() => removePlayer(p.id)}>
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {startingXI.length > 0 && (
                    <div className="starting-xi-display">
                      <h2 className="app-h2">Starting XI</h2>
                      <div className="starting-xi-grid">
                        {startingXI.map((p) => (
                          <div key={p.id} className="starting-xi-player-card">
                            <div className="xi-player-name">{p.name}</div>
                            <div className="xi-player-badge">{p.position}</div>
                            <div className="xi-player-price">{p.value.toFixed(1)} M</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="app-section">
                    <h2 className="app-h2">Filters</h2>
                    <div className="filter-group">
                      <div className="filter-row">
                        <label>Team:</label>
                        <select value={filterTeamId ?? ''} onChange={(e) => setFilterTeamId(e.target.value ? Number(e.target.value) : null)} className="app-btn">
                          <option value="">All Teams</option>
                          {teams.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="filter-row">
                        <label>Positions:</label>
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
                          <th>Name</th>
                          <th>Position</th>
                          <th>Team</th>
                          <th>Value (M)</th>
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
                                  disabled={isSelectedRow || selected.length >= 15 || sameTeamCount >= 3 || willExceedBudget}
                                  onClick={() => addPlayer(p)}
                                >
                                  Add
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
          <button className={page === 'builder' ? 'active' : undefined} onClick={() => setPage('builder')}>
            Team Builder
          </button>
          <button className={page === 'admin' ? 'active' : undefined} onClick={() => setPage('admin')}>
            Admin Portal
          </button>
        </div>
        <div className="nav-right">
          <span className="user-info">Welcome, {userName}!</span>
          <button onClick={handleLogout} className="logout-button">
            Logout
          </button>
        </div>
      </nav>

      <main className="app-main">
        <div className="app-card">
          {page === 'builder' && (
            <>
              <h1 className="app-h1">Fantasy League Team Builder</h1>
              {error && <div className="app-alert">{error}</div>}

              <div className="app-section">
                <div className="app-section-header">
                  <h2 className="app-h2">
                    Your Team ({selected.length}/15) — Budget: {totalValue().toFixed(1)} / {INITIAL_BUDGET}
                  </h2>
                </div>

                {selected.length === 0 ? (
                  <div className="app-muted">No players selected yet.</div>
                ) : (
                  <ul className="app-list">
                    {selected.map((p) => (
                      <li key={p.id} className="app-list-item">
                        <div className="app-list-main">
                          <div className="app-list-title">{p.name}</div>
                          <div className="app-list-sub">
                            {p.position} — {teams.find((t) => t.id === p.teamId)?.name} — {p.value.toFixed(1)} M
                          </div>
                        </div>
                        <button className="app-btn app-btn-danger" onClick={() => removePlayer(p.id)}>
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                {startingXI.length > 0 && (
                  <div className="starting-xi-display">
                    <h2 className="app-h2">Starting XI</h2>
                    <div className="app-actions">
                      <button className="app-btn app-btn-primary" onClick={() => setTeamViewTab('startingXI')}>
                        Edit Starting XI
                      </button>
                    </div>
                    <div className="starting-xi-grid">
                      {startingXI.map((p) => (
                        <div key={p.id} className="starting-xi-player-card">
                          <div className="xi-player-name">{p.name}</div>
                          <div className="xi-player-badge">{p.position}</div>
                          <div className="xi-player-price">{p.value.toFixed(1)} M</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="app-table-wrap">
                  <table className="app-table">
                    <thead>
                      <tr>
                        <th>Name</th>
                        <th>Position</th>
                        <th>Team</th>
                        <th>Value (M)</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {players.map((p) => {
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
                                disabled={isSelectedRow || selected.length >= 15 || sameTeamCount >= 3 || willExceedBudget}
                                onClick={() => addPlayer(p)}
                              >
                                Add
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {page === 'admin' && <AdminPortal />}
        </div>
      </main>
    </div>
  );
}
