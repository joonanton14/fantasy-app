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
  date: string; // ISO string
};

type TabKey = "players" | "fixtures" | "points";

function fmtDate(iso: string) {
  // Keep it simple: show local browser time
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fi-FI", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function clampInt(v: string) {
  // allow negative, allow empty
  if (v.trim() === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return String(Math.trunc(n));
}

export default function AdminPortal() {
  const [tab, setTab] = useState<TabKey>("players");

  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [fixtures, setFixtures] = useState<Fixture[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Players tab
  const [playerQuery, setPlayerQuery] = useState("");

  // Fixtures tab
  const [fixtureQuery, setFixtureQuery] = useState("");

  // Points tab
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);
  const [pointsError, setPointsError] = useState<string | null>(null);

  // Points map for currently selected fixture: playerId -> number (stored as string for inputs)
  const [pointInputs, setPointInputs] = useState<Record<number, string>>({});
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Load base data
  useEffect(() => {
    let cancelled = false;

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const [pRes, tRes, fRes] = await Promise.all([
          apiCall("/players", { method: "GET" }),
          apiCall("/teams", { method: "GET" }),
          apiCall("/admin/fixtures", { method: "GET" }),
        ]);

        if (!pRes.ok) throw new Error("Failed to load players");
        if (!tRes.ok) throw new Error("Failed to load teams");
        if (!fRes.ok) throw new Error("Failed to load fixtures (admin)");

        const p = (await pRes.json()) as Player[];
        const t = (await tRes.json()) as Team[];
        const fJson = (await fRes.json()) as { fixtures: Fixture[] };

        if (cancelled) return;
        setPlayers(p);
        setTeams(t);
        setFixtures(fJson.fixtures ?? []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const teamNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const t of teams) map.set(t.id, t.name);
    return map;
  }, [teams]);

  // Derived: sorted fixtures
  const fixturesSorted = useMemo(() => {
    const arr = [...fixtures];
    arr.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    return arr;
  }, [fixtures]);

  // Players filtering
  const filteredPlayers = useMemo(() => {
    const q = playerQuery.trim().toLowerCase();
    if (!q) return players;
    return players.filter((p) => p.name.toLowerCase().includes(q));
  }, [players, playerQuery]);

  // Fixtures filtering
  const filteredFixtures = useMemo(() => {
    const q = fixtureQuery.trim().toLowerCase();
    if (!q) return fixturesSorted;

    return fixturesSorted.filter((fx) => {
      const home = (teamNameById.get(fx.homeTeamId) || "").toLowerCase();
      const away = (teamNameById.get(fx.awayTeamId) || "").toLowerCase();
      const text = `${fx.id} ${home} ${away} ${fx.date}`.toLowerCase();
      return text.includes(q);
    });
  }, [fixtureQuery, fixturesSorted, teamNameById]);

  const selectedFixture = useMemo(() => {
    if (!selectedFixtureId) return null;
    return fixtures.find((f) => f.id === selectedFixtureId) ?? null;
  }, [fixtures, selectedFixtureId]);

  const playersInSelectedGame = useMemo(() => {
    if (!selectedFixture) return [];
    const { homeTeamId, awayTeamId } = selectedFixture;
    return players
      .filter((p) => p.teamId === homeTeamId || p.teamId === awayTeamId)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [players, selectedFixture]);

  // When fixture changes: load saved points
  useEffect(() => {
    let cancelled = false;

    async function loadPoints(gameId: number) {
      setPointsLoading(true);
      setPointsError(null);
      setSaveStatus("idle");

      try {
        const res = await apiCall(`/admin/game-points?gameId=${encodeURIComponent(String(gameId))}`, {
          method: "GET",
        });

        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error((j as any)?.error || "Failed to load game points");
        }

        const json = (await res.json()) as { gameId: number; points: Record<string, number> };
        if (cancelled) return;

        const inputs: Record<number, string> = {};
        for (const [pidStr, pts] of Object.entries(json.points ?? {})) {
          const pid = Number(pidStr);
          if (Number.isInteger(pid)) inputs[pid] = String(pts);
        }

        setPointInputs(inputs);
      } catch (e) {
        if (!cancelled) setPointsError(e instanceof Error ? e.message : "Failed to load points");
      } finally {
        if (!cancelled) setPointsLoading(false);
      }
    }

    if (selectedFixtureId) loadPoints(selectedFixtureId);
    else {
      setPointInputs({});
      setPointsError(null);
      setSaveStatus("idle");
    }

    return () => {
      cancelled = true;
    };
  }, [selectedFixtureId]);

  async function saveGamePoints() {
    if (!selectedFixtureId) return;

    setSaveStatus("saving");
    setPointsError(null);

    // Build points payload with integers, omit empty
    const payload: Record<string, number> = {};
    for (const [pidStr, v] of Object.entries(pointInputs)) {
      const pid = Number(pidStr);
      if (!Number.isInteger(pid)) continue;
      const trimmed = String(v ?? "").trim();
      if (trimmed === "") continue;
      const n = Number(trimmed);
      if (!Number.isFinite(n)) continue;
      payload[String(pid)] = Math.trunc(n);
    }

    try {
      const res = await apiCall("/admin/game-points", {
        method: "POST",
        body: JSON.stringify({ gameId: selectedFixtureId, points: payload }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as any)?.error || "Save failed");
      }

      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1200);
    } catch (e) {
      setSaveStatus("idle");
      setPointsError(e instanceof Error ? e.message : "Save failed");
    }
  }

  function goNextFixture() {
    if (!selectedFixtureId) return;
    const idx = fixturesSorted.findIndex((f) => f.id === selectedFixtureId);
    if (idx < 0) return;
    const next = fixturesSorted[idx + 1];
    if (!next) return;
    setSelectedFixtureId(next.id);
  }

  function PointsEditor() {
    if (!selectedFixture) {
      return <div className="app-muted">Valitse ottelu listasta.</div>;
    }

    const homeName = teamNameById.get(selectedFixture.homeTeamId) ?? `#${selectedFixture.homeTeamId}`;
    const awayName = teamNameById.get(selectedFixture.awayTeamId) ?? `#${selectedFixture.awayTeamId}`;

    return (
      <div className="app-card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div className="app-h2" style={{ margin: 0 }}>
              #{selectedFixture.id}: {homeName} – {awayName}
            </div>
            <div className="app-muted">{fmtDate(selectedFixture.date)}</div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="app-btn app-btn-primary" onClick={saveGamePoints} disabled={saveStatus === "saving"}>
              {saveStatus === "saving" ? "Tallennetaan…" : saveStatus === "saved" ? "Tallennettu ✓" : "Tallenna"}
            </button>
            <button className="app-btn" onClick={goNextFixture} disabled={saveStatus === "saving"}>
              Tallenna & seuraava
            </button>
          </div>
        </div>

        {pointsLoading && <div className="app-muted" style={{ marginTop: 10 }}>Ladataan pisteitä…</div>}
        {pointsError && <div className="app-alert" style={{ marginTop: 10 }}>{pointsError}</div>}

        <div style={{ marginTop: 12 }}>
          <div className="app-muted" style={{ marginBottom: 8 }}>
            Syötä pisteet vain tämän ottelun pelaajille. (Tyhjä = ei pisteitä)
          </div>

          <div className="app-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Pelaaja</th>
                  <th>Joukkue</th>
                  <th>Pos</th>
                  <th style={{ width: 120 }}>Pisteet</th>
                </tr>
              </thead>
              <tbody>
                {playersInSelectedGame.map((p) => {
                  const tName = teamNameById.get(p.teamId) ?? "";
                  const val = pointInputs[p.id] ?? "";
                  return (
                    <tr key={p.id}>
                      <td>{p.name}</td>
                      <td>{tName}</td>
                      <td>{p.position}</td>
                      <td>
                        <input
                          className="app-btn"
                          style={{ width: "100%" }}
                          value={val}
                          inputMode="numeric"
                          placeholder="0"
                          onChange={(e) => {
                            const next = clampInt(e.target.value);
                            setPointInputs((prev) => ({ ...prev, [p.id]: next }));
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}

                {playersInSelectedGame.length === 0 && (
                  <tr>
                    <td colSpan={4} className="app-muted">
                      Ei pelaajia (tarkista teamId-mapping ja pelaajadatan teamId:t)
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="app-muted" style={{ marginTop: 10 }}>
            Vinkki: Avaa sama ottelu myöhemmin → tallennetut pisteet tulevat takaisin ja voit muokata niitä.
          </div>
        </div>
      </div>
    );
  }

  if (loading) return <div className="app-muted" style={{ padding: 16 }}>Loading admin…</div>;

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div className="app-alert">{error}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="app-section-header" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div className="app-actions">
          <button
            className={`app-btn ${tab === "players" ? "app-btn-active" : ""}`}
            onClick={() => setTab("players")}
          >
            Pelaajat
          </button>
          <button
            className={`app-btn ${tab === "fixtures" ? "app-btn-active" : ""}`}
            onClick={() => setTab("fixtures")}
          >
            Ottelut
          </button>
          <button
            className={`app-btn ${tab === "points" ? "app-btn-active" : ""}`}
            onClick={() => setTab("points")}
          >
            Pisteet
          </button>
        </div>

        {tab === "points" && (
          <div className="app-muted" style={{ alignSelf: "center" }}>
            Valittu ottelu: {selectedFixtureId ? `#${selectedFixtureId}` : "—"}
          </div>
        )}
      </div>

      {tab === "players" && (
        <div className="app-card" style={{ marginTop: 12 }}>
          <div className="app-h2" style={{ marginTop: 0 }}>Pelaajat</div>

          <div className="filter-row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <label style={{ minWidth: 90 }}>Haku:</label>
            <input
              className="app-btn"
              style={{ width: "100%" }}
              value={playerQuery}
              placeholder="Etsi nimellä…"
              onChange={(e) => setPlayerQuery(e.target.value)}
            />
          </div>

          <div className="app-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Nimi</th>
                  <th>Pos</th>
                  <th>Joukkue</th>
                  <th>Arvo</th>
                </tr>
              </thead>
              <tbody>
                {filteredPlayers.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.position}</td>
                    <td>{teamNameById.get(p.teamId) ?? ""}</td>
                    <td>{p.value.toFixed(1)} M</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "fixtures" && (
        <div className="app-card" style={{ marginTop: 12 }}>
          <div className="app-h2" style={{ marginTop: 0 }}>Ottelut</div>

          <div className="filter-row" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <label style={{ minWidth: 90 }}>Haku:</label>
            <input
              className="app-btn"
              style={{ width: "100%" }}
              value={fixtureQuery}
              placeholder="Etsi: joukkue / id / pvm…"
              onChange={(e) => setFixtureQuery(e.target.value)}
            />
          </div>

          <div className="app-table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th style={{ width: 70 }}>#</th>
                  <th>Ottelu</th>
                  <th style={{ width: 220 }}>Aika</th>
                  <th style={{ width: 160 }}></th>
                </tr>
              </thead>
              <tbody>
                {filteredFixtures.map((fx) => {
                  const home = teamNameById.get(fx.homeTeamId) ?? `#${fx.homeTeamId}`;
                  const away = teamNameById.get(fx.awayTeamId) ?? `#${fx.awayTeamId}`;
                  return (
                    <tr key={fx.id}>
                      <td>{fx.id}</td>
                      <td>{home} – {away}</td>
                      <td>{fmtDate(fx.date)}</td>
                      <td>
                        <button
                          className="app-btn app-btn-primary"
                          onClick={() => {
                            setSelectedFixtureId(fx.id);
                            setTab("points");
                          }}
                        >
                          Syötä pisteet
                        </button>
                      </td>
                    </tr>
                  );
                })}

                {filteredFixtures.length === 0 && (
                  <tr>
                    <td colSpan={4} className="app-muted">Ei osumia.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "points" && (
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 12 }}>
          {/* Left: fixture list */}
          <div className="app-card">
            <div className="app-h2" style={{ marginTop: 0 }}>Ottelut</div>
            <div className="app-muted" style={{ marginBottom: 10 }}>Klikkaa ottelu → syötä pisteet.</div>

            <input
              className="app-btn"
              style={{ width: "100%", marginBottom: 10 }}
              value={fixtureQuery}
              placeholder="Haku…"
              onChange={(e) => setFixtureQuery(e.target.value)}
            />

            <div style={{ maxHeight: 520, overflow: "auto" }}>
              {filteredFixtures.map((fx) => {
                const home = teamNameById.get(fx.homeTeamId) ?? `#${fx.homeTeamId}`;
                const away = teamNameById.get(fx.awayTeamId) ?? `#${fx.awayTeamId}`;
                const active = fx.id === selectedFixtureId;

                return (
                  <button
                    key={fx.id}
                    type="button"
                    className={`app-btn ${active ? "app-btn-active" : ""}`}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      display: "block",
                      marginBottom: 8,
                      padding: 10,
                      whiteSpace: "normal",
                    }}
                    onClick={() => setSelectedFixtureId(fx.id)}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <div><b>#{fx.id}</b> {home} – {away}</div>
                    </div>
                    <div className="app-muted" style={{ marginTop: 4 }}>{fmtDate(fx.date)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: editor */}
          <div>
            <PointsEditor />
          </div>
        </div>
      )}
    </div>
  );
}
