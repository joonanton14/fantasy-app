import { useEffect, useState } from 'react';
import { apiCall } from './api';

interface Team {
  id: number;
  name: string;
}

interface Player {
  id: number;
  name: string;
  position: 'GK' | 'DEF' | 'MID' | 'FWD';
  teamId: number;
  value: number;
}

/**
 * AdminPortal component provides a simple UI for managing teams and players.
 * It allows admins to add new teams and players, and displays existing
 * teams and players in lists. In a real application you would
 * authenticate admins before allowing access to this component.
 */
export default function AdminPortal() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);

  // state for new team form
  const [newTeamName, setNewTeamName] = useState('');
  const [teamMessage, setTeamMessage] = useState<string | null>(null);

  // state for new player form
  const [playerName, setPlayerName] = useState('');
  const [playerPosition, setPlayerPosition] = useState<'GK' | 'DEF' | 'MID' | 'FWD'>('GK');
  const [playerTeamId, setPlayerTeamId] = useState<number>(0);
  const [playerValue, setPlayerValue] = useState<number>(4);
  const [playerMessage, setPlayerMessage] = useState<string | null>(null);

  // Load teams and players on mount
  useEffect(() => {
    async function load() {
      try {
        const [teamRes, playerRes] = await Promise.all([
          apiCall('/teams'),
          apiCall('/players')
        ]);
        const teamData: Team[] = await teamRes.json();
        const playerData: Player[] = await playerRes.json();
        setTeams(teamData);
        setPlayers(playerData);
        // pre-select first team for player form if available
        if (teamData.length > 0) {
          setPlayerTeamId(teamData[0].id);
        }
      } catch (err) {
        // ignore errors for now
      }
    }
    load();
  }, []);

  // handle new team submission
  async function addTeam(e: React.FormEvent) {
    e.preventDefault();
    setTeamMessage(null);
    try {
      const res = await apiCall('/admin/teams', {
        method: 'POST',
        body: JSON.stringify({ name: newTeamName })
      });
      if (res.ok) {
        const team = await res.json();
        setTeams([...teams, team]);
        setTeamMessage(`Team "${team.name}" created.`);
        setNewTeamName('');
        // update selected team for player form if none selected
        if (playerTeamId === 0) setPlayerTeamId(team.id);
      } else {
        const err = await res.json();
        setTeamMessage(`Error: ${err.error ?? 'Unable to create team'}`);
      }
    } catch (err) {
      setTeamMessage('Network error: unable to create team');
    }
  }

  // handle new player submission
  async function addPlayer(e: React.FormEvent) {
    e.preventDefault();
    setPlayerMessage(null);
    try {
      const res = await apiCall('/admin/players', {
        method: 'POST',
        body: JSON.stringify({
          name: playerName,
          position: playerPosition,
          teamId: playerTeamId,
          value: playerValue
        })
      });
      if (res.ok) {
        const player = await res.json();
        setPlayers([...players, player]);
        setPlayerMessage(`Player "${player.name}" created.`);
        setPlayerName('');
        setPlayerPosition('GK');
        setPlayerValue(4);
      } else {
        const err = await res.json();
        setPlayerMessage(`Error: ${err.error ?? 'Unable to create player'}`);
      }
    } catch (err) {
      setPlayerMessage('Network error: unable to create player');
    }
  }

  return (
    <div>
      <h2 className="app-h1">Admin Portal</h2>
      
      <div className="admin-section">
        <h3 className="admin-section-title">Add New Team</h3>
        <form onSubmit={addTeam} className="admin-form">
          <div className="admin-form-row">
            <label htmlFor="team-name">Team Name</label>
            <input
              id="team-name"
              type="text"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              required
              placeholder="Enter team name"
            />
          </div>
          <div className="admin-form-actions">
            <button type="submit" className="app-btn app-btn-primary">Add Team</button>
          </div>
        </form>
        {teamMessage && <div className={`admin-message ${teamMessage.startsWith('Error') ? 'error' : 'success'}`}>{teamMessage}</div>}
      </div>

      <div className="admin-section">
        <h3 className="admin-section-title">Add New Player</h3>
      <div className="admin-section">
        <h3 className="admin-section-title">Add New Player</h3>
        {teams.length === 0 ? (
          <div className="app-alert">Please create a team first.</div>
        ) : (
          <form onSubmit={addPlayer} className="admin-form">
            <div className="admin-form-row">
              <label htmlFor="player-name">Name</label>
              <input
                id="player-name"
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                required
                placeholder="Player name"
              />
            </div>
            <div className="admin-form-row">
              <label htmlFor="player-position">Position</label>
              <select
                id="player-position"
                value={playerPosition}
                onChange={(e) => setPlayerPosition(e.target.value as 'GK' | 'DEF' | 'MID' | 'FWD')}
              >
                <option value="GK">GK (Goalkeeper)</option>
                <option value="DEF">DEF (Defender)</option>
                <option value="MID">MID (Midfielder)</option>
                <option value="FWD">FWD (Forward)</option>
              </select>
            </div>
            <div className="admin-form-row">
              <label htmlFor="player-team">Team</label>
              <select
                id="player-team"
                value={playerTeamId}
                onChange={(e) => setPlayerTeamId(Number(e.target.value))}
              >
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="admin-form-row">
              <label htmlFor="player-value">Value (4–12M)</label>
              <input
                id="player-value"
                type="number"
                step="0.1"
                min="4"
                max="12"
                value={playerValue}
                onChange={(e) => setPlayerValue(Number(e.target.value))}
              />
            </div>
            <div className="admin-form-actions">
              <button type="submit" className="app-btn app-btn-primary">Add Player</button>
            </div>
          </form>
        )}
        {playerMessage && <div className={`admin-message ${playerMessage.startsWith('Error') ? 'error' : 'success'}`}>{playerMessage}</div>}
      </div>

      <div className="admin-section">
        <h3 className="admin-section-title">Teams ({teams.length})</h3>
        {teams.length === 0 ? (
          <div className="app-muted">No teams available.</div>
        ) : (
          <ul className="admin-list">
            {teams.map((t) => (
              <li key={t.id}>{t.name}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="admin-section">
        <h3 className="admin-section-title">Players ({players.length})</h3>
        {players.length === 0 ? (
          <div className="app-muted">No players available.</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Position</th>
                  <th>Team</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p) => {
                  const team = teams.find((t) => t.id === p.teamId);
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{p.position}</td>
                      <td>{team?.name ?? p.teamId}</td>
                      <td>{p.value.toFixed(1)}M</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  </div>
  );
}
