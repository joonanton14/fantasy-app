import { useEffect, useMemo, useState } from "react";
import { apiCall } from "./api";

type Position = "GK" | "DEF" | "MID" | "FWD";

interface Player {
  id: number;
  name: string;
  position: Position;
  teamId: number;
  value: number;
}

interface Team {
  id: number;
  name: string;
}

type PointsMap = Record<number, number>;

function parseIntSafe(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  return n;
}

export default function AdminPortal() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [loadingBase, setLoadingBase] = useState(false);

  const [gw, setGw] = useState<number>(1);
  const [search, setSearch] = useState("");
  const [filterTeamId, setFilterTeamId] = useState<number | null>(null);
  const [filterPos, setFilterPos] = useState<Position | "ALL">("ALL");
  const [onlyEdited, setOnlyEdited] = useState(false);

  const [points, setPoints] = useState<PointsMap>({});
  const [loadingPoints, setLoadingPoints] = useState(false);
  const [saving, setSaving] = useState(false);

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [leaderboard, setLeaderboard] = useState<Array<{ username: string; total: number }> | null>(null);
  const [loadingLb, setLoadingLb] = useState(false);

  // Load players + teams once
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoadingBase(true);
      setError(null);
      try {
        const [playersRes, teamsRes] = await Promise.all([apiCall("/players"), apiCall("/teams")]);
        const playersData: Player[] = await playersRes.json();
        const teamsData: Team[] = await teamsRes.json();
        if (cancelled) return;
        setPlayers(playersData);
        setTeams(teamsData);
      } catch (e) {
        if (cancelled) return;
        setError("Failed to load players/teams");
      } finally {
        if (!cancelled) setLoadingBase(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const teamNameById = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of teams) m.set(t.id, t.name);
    return m;
  }, [teams]);

  const editedCount = useMemo(() => Object.keys(points).length, [points]);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players
      .filter((p) => {
        if (filterTeamId !== null && p.teamId !== filterTeamId) return false;
        if (filterPos !== "ALL" && p.position !== filterPos) return false;

        if (onlyEdited && points[p.id] === undefined) return false;

        if (!q) return true;
        const tn = teamNameById.get(p.teamId)?.toLowerCase() ?? "";
        return p.name.toLowerCase().includes(q) || tn.includes(q) || String(p.id).includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [players, search, filterTeamId, filterPos, onlyEdited, points, teamNameById]);

  async function loadGwPoints() {
    setLoadingPoints(true);
    setError(null);
    setStatus(null);
    try {
      const res = await apiCall(`/admin/points?gw=${gw}`, { method: "GET" });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any)?.error || "Failed to load points");
      }

      const j = await res.json();
      const raw = (j?.points ?? {}) as Record<string, number>;

      const next: PointsMap = {};
      for (const [k, v] of Object.entries(raw)) {
        const pid = Number(k);
        if (Number.isInteger(pid) && Number.isInteger(v)) next[pid] = v;
      }

      setPoints(next);
      setStatus(`Loaded GW ${gw} points (${Object.keys(next).length} players).`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load points");
    } finally {
      setLoadingPoints(false);
    }
  }

  async function saveGwPoints() {
    setSaving(true);
    setError(null);
    setStatus(null);

    try {
      // Convert to string-key object for storage
      const payload: Record<string, number> = {};
      for (const [pidStr, val] of Object.entries(points)) {
        const pid = Number(pidStr);
        if (!Number.isInteger(pid)) continue;
        if (!Number.isInteger(val)) continue;
        payload[String(pid)] = val;
      }

      const res =await apiCall("/admin/points", {
  method: "POST",
  body: JSON.stringify({ gw, points: payload }),
});


      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any)?.error || "Failed to save points");
      }

      setStatus(`Saved GW ${gw} points (${Object.keys(payload).length} players).`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save points");
    } finally {
      setSaving(false);
    }
  }

  async function loadLeaderboardPreview() {
    setLoadingLb(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`/api/leaderboard?gw=${encodeURIComponent(String(gw))}`, {
        method: "GET",
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any)?.error || "Failed to load leaderboard");
      }

      const j = await res.json();
      setLeaderboard((j?.leaderboard ?? []) as Array<{ username: string; total: number }>);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load leaderboard");
    } finally {
      setLoadingLb(false);
    }
  }

  function setPlayerPoints(playerId: number, valueStr: string) {
    const parsed = parseIntSafe(valueStr);
    setPoints((prev) => {
      const next = { ...prev };
      if (parsed === null) delete next[playerId];
      else next[playerId] = parsed;
      return next;
    });
  }

  function clearAll() {
    setPoints({});
    setLeaderboard(null);
    setStatus("Cleared all unsaved edits.");
    setError(null);
  }

  return (
    <div className="app-card">
      <h1 className="app-h1">Admin Portal</h1>

      {error && <div className="app-alert">{error}</div>}
      {status && <div className="app-muted" style={{ marginBottom: 10 }}>{status}</div>}

      <div className="app-section">
        <div className="app-section-header">
          <h2 className="app-h2">Gameweek Points</h2>

          <div className="app-actions" style={{ gap: 8, flexWrap: "wrap" }}>
            <label className="app-muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              GW
              <input
                type="number"
                min={1}
                value={gw}
                onChange={(e) => setGw(Math.max(1, Number(e.target.value || 1)))}
                style={{ width: 90 }}
              />
            </label>

            <button className="app-btn" onClick={loadGwPoints} disabled={loadingPoints || saving}>
              {loadingPoints ? "Loading…" : "Load GW"}
            </button>

            <button className="app-btn app-btn-primary" onClick={saveGwPoints} disabled={saving || loadingPoints}>
              {saving ? "Saving…" : "Save GW"}
            </button>

            <button className="app-btn app-btn-danger" onClick={clearAll} disabled={saving || loadingPoints}>
              Clear edits
            </button>

            <button className="app-btn" onClick={loadLeaderboardPreview} disabled={loadingLb}>
              {loadingLb ? "Loading…" : "Leaderboard preview"}
            </button>

            <div className="app-muted" style={{ alignSelf: "center" }}>
              Edited: <b>{editedCount}</b>
            </div>
          </div>
        </div>

        <div className="filter-group" style={{ marginTop: 12 }}>
          <div className="filter-row" style={{ gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="app-muted">Search</span>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Name / team / id…"
                style={{ minWidth: 260 }}
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="app-muted">Team</span>
              <select
                value={filterTeamId ?? ""}
                onChange={(e) => setFilterTeamId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">All</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="app-muted">Position</span>
              <select value={filterPos} onChange={(e) => setFilterPos(e.target.value as any)}>
                <option value="ALL">All</option>
                <option value="GK">GK</option>
                <option value="DEF">DEF</option>
                <option value="MID">MID</option>
                <option value="FWD">FWD</option>
              </select>
            </label>

            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 22 }}>
              <input type="checkbox" checked={onlyEdited} onChange={(e) => setOnlyEdited(e.target.checked)} />
              Only edited
            </label>
          </div>
        </div>

        <div className="app-table-wrap" style={{ marginTop: 12 }}>
          <table className="app-table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>ID</th>
                <th>Name</th>
                <th style={{ width: 90 }}>Pos</th>
                <th>Team</th>
                <th style={{ width: 130 }}>Points</th>
              </tr>
            </thead>
            <tbody>
              {loadingBase ? (
                <tr>
                  <td colSpan={5} className="app-muted">
                    Loading players…
                  </td>
                </tr>
              ) : filteredPlayers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="app-muted">
                    No players found.
                  </td>
                </tr>
              ) : (
                filteredPlayers.map((p) => {
                  const teamName = teamNameById.get(p.teamId) ?? "";
                  const current = points[p.id];
                  return (
                    <tr key={p.id}>
                      <td className="app-muted">{p.id}</td>
                      <td>{p.name}</td>
                      <td>{p.position}</td>
                      <td className="app-muted">{teamName}</td>
                      <td>
                        <input
                          type="number"
                          step={1}
                          value={current ?? ""}
                          onChange={(e) => setPlayerPoints(p.id, e.target.value)}
                          placeholder="—"
                          style={{ width: 110 }}
                        />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {leaderboard && (
          <div style={{ marginTop: 16 }}>
            <h2 className="app-h2">Leaderboard preview (GW {gw})</h2>
            {leaderboard.length === 0 ? (
              <div className="app-muted">No teams yet.</div>
            ) : (
              <div className="app-table-wrap">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th style={{ width: 60 }}>#</th>
                      <th>User</th>
                      <th style={{ width: 120 }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.slice(0, 20).map((r, idx) => (
                      <tr key={`${r.username}-${idx}`}>
                        <td className="app-muted">{idx + 1}</td>
                        <td>{r.username}</td>
                        <td>
                          <b>{r.total}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
