// client/src/adminPortal.tsx
import React, { JSX, useEffect, useMemo, useState } from "react";
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
  round?: number;
};

type MinutesBucket = "0" | "1_59" | "60+";

type PlayerEventInput = {
  minutes: MinutesBucket;
  goals: number;
  assists: number;
  cleanSheet: boolean;
  penMissed: number;
  penSaved: number;
  yellow: number;
  red: number;
  ownGoals: number;
};

const DEFAULT_EVENT: PlayerEventInput = {
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

// same as api/lib/scoring.ts so admin sees the same points preview
function calcPoints(pos: Position, ev: PlayerEventInput): number {
  let pts = 0;

  if (ev.minutes === "1_59") pts += 1;
  if (ev.minutes === "60+") pts += 2;

  if (ev.goals > 0) {
    if (pos === "GK") pts += ev.goals * 10;
    else if (pos === "DEF") pts += ev.goals * 6;
    else if (pos === "MID") pts += ev.goals * 5;
    else pts += ev.goals * 4;
  }

  pts += ev.assists * 3;

  if (ev.cleanSheet) {
    if (pos === "GK" || pos === "DEF") pts += 4;
    else if (pos === "MID") pts += 1;
  }

  if (pos === "GK") pts += ev.penSaved * 3;
  pts += ev.penMissed * -2;

  pts += ev.yellow * -1;
  pts += ev.red * -3;
  pts += ev.ownGoals * -2;

  return pts;
}

function toInt(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

function fmtFixture(f: Fixture, teamsById: Map<number, Team>) {
  const home = teamsById.get(f.homeTeamId)?.name ?? `#${f.homeTeamId}`;
  const away = teamsById.get(f.awayTeamId)?.name ?? `#${f.awayTeamId}`;
  const d = new Date(f.date);
  const dateStr = isNaN(d.getTime()) ? f.date : d.toLocaleString();
  return `${f.id} — ${home} vs ${away} — ${dateStr}`;
}

export default function AdminPortal() {
  const [tab, setTab] = useState<"players" | "fixtures" | "score">("players");

  const [players, setPlayers] = useState<Player[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const teamsById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const playerNameById = useMemo(() => new Map(players.map((p) => [p.id, p.name])), [players]);

  const [fixtures, setFixtures] = useState<Fixture[]>([]);
  const [fixturesErr, setFixturesErr] = useState<string | null>(null);

  const [loadingBase, setLoadingBase] = useState(false);

  // scoring state
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [selectedRound, setSelectedRound] = useState<number | "all">("all");
  const [manualGameId, setManualGameId] = useState<string>("");

  const [events, setEvents] = useState<Record<string, PlayerEventInput>>({});
  const [loadEventsStatus, setLoadEventsStatus] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [finalizeStatus, setFinalizeStatus] = useState<string | null>(null);
  const [finalizeResults, setFinalizeResults] = useState<Array<{ username: string; points: number; subsUsed: number[] }>>(
    []
  );

  // ✅ NEW: finalize whole round status/results (computed client-side by calling finalize-game per fixture)
  const [finalizeRoundStatus, setFinalizeRoundStatus] = useState<string | null>(null);
  const [finalizeRoundResults, setFinalizeRoundResults] = useState<Array<{ username: string; gwPoints: number }>>([]);

  // player search
  const [playerSearch, setPlayerSearch] = useState("");
  type SortKey = "name_asc" | "name_desc" | "value_desc" | "value_asc" | "newest" | "oldest";
  const [sortKey, setSortKey] = useState<SortKey>("name_asc");
  const [filterTeam, setFilterTeam] = useState<number | "all">("all");

  function comparePlayers(a: Player, b: Player, key: SortKey) {
    switch (key) {
      case "name_asc":
        return a.name.localeCompare(b.name);
      case "name_desc":
        return b.name.localeCompare(a.name);
      case "value_desc":
        return (b.value ?? 0) - (a.value ?? 0);
      case "value_asc":
        return (a.value ?? 0) - (b.value ?? 0);
      case "newest":
        return (b.id ?? 0) - (a.id ?? 0);
      case "oldest":
        return (a.id ?? 0) - (b.id ?? 0);
      default:
        return 0;
    }
  }

  // load players + teams
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoadingBase(true);
      try {
        const [pRes, tRes] = await Promise.all([apiCall("/players"), apiCall("/teams")]);
        if (!pRes.ok) throw new Error("Failed to load players");
        if (!tRes.ok) throw new Error("Failed to load teams");
        const p = (await pRes.json()) as Player[];
        const t = (await tRes.json()) as Team[];
        if (cancelled) return;
        setPlayers(p);
        setTeams(t);
      } catch (e) {
        if (!cancelled) setFixturesErr(e instanceof Error ? e.message : "Failed to load base data");
      } finally {
        if (!cancelled) setLoadingBase(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // load fixtures
  useEffect(() => {
    let cancelled = false;

    async function loadFx() {
      setFixturesErr(null);
      try {
        const res = await apiCall("/admin/fixtures", { method: "GET" });
        if (!res.ok) throw new Error("Failed to load fixtures (admin)");
        const json = await res.json();
        const fx = (json.fixtures ?? []) as Fixture[];
        if (!cancelled) setFixtures(fx);
      } catch (e) {
        if (!cancelled) setFixturesErr(e instanceof Error ? e.message : "Failed to load fixtures");
      }
    }

    loadFx();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedFixture = useMemo(() => {
    if (!selectedGameId) return null;
    return fixtures.find((f) => f.id === selectedGameId) ?? null;
  }, [fixtures, selectedGameId]);

  const effectiveGameId = useMemo(() => {
    if (selectedGameId) return selectedGameId;
    const n = Number(manualGameId);
    if (Number.isInteger(n) && n > 0) return n;
    return null;
  }, [selectedGameId, manualGameId]);

  const rounds = useMemo(() => {
    const set = new Set<number>();
    for (const f of fixtures) {
      if (typeof f.round === "number") set.add(f.round);
    }
    return Array.from(set).sort((a, b) => a - b);
  }, [fixtures]);

  const fixturesForRound = useMemo(() => {
    if (selectedRound === "all") return fixtures;
    return fixtures.filter((f) => f.round === selectedRound);
  }, [fixtures, selectedRound]);

  const fixturesForSelectedRoundOnly = useMemo(() => {
    if (selectedRound === "all") return [];
    return fixtures.filter((f) => f.round === selectedRound).slice().sort((a, b) => a.id - b.id);
  }, [fixtures, selectedRound]);

  const homeTeamId = selectedFixture?.homeTeamId ?? null;
  const awayTeamId = selectedFixture?.awayTeamId ?? null;

  const homePlayers = useMemo(() => {
    if (!homeTeamId) return [];
    return players.filter((p) => p.teamId === homeTeamId).sort((a, b) => a.name.localeCompare(b.name));
  }, [players, homeTeamId]);

  const awayPlayers = useMemo(() => {
    if (!awayTeamId) return [];
    return players.filter((p) => p.teamId === awayTeamId).sort((a, b) => a.name.localeCompare(b.name));
  }, [players, awayTeamId]);

  const filteredPlayers = useMemo(() => {
    const q = playerSearch.trim().toLowerCase();
    let list = players;

    if (filterTeam !== "all") list = list.filter((p) => p.teamId === filterTeam);
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));

    return list.slice().sort((a, b) => comparePlayers(a, b, sortKey));
  }, [players, playerSearch, filterTeam, sortKey]);

  async function loadGameEvents(gameId: number) {
    setLoadEventsStatus(null);
    setSaveStatus(null);
    setFinalizeStatus(null);
    setFinalizeResults([]);
    setFinalizeRoundStatus(null);
    setFinalizeRoundResults([]);

    try {
      setLoadEventsStatus("Loading saved events…");
      const res = await apiCall(`/admin/game-events?gameId=${encodeURIComponent(String(gameId))}`, { method: "GET" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || "Failed to load game events");
      }
      const data = await res.json();
      setEvents(data.events ?? {});
      setLoadEventsStatus("Loaded.");
      setTimeout(() => setLoadEventsStatus(null), 1000);
    } catch (e) {
      setLoadEventsStatus(e instanceof Error ? e.message : "Failed to load events");
    }
  }

  async function saveGameEvents(gameId: number) {
    setSaveStatus(null);
    try {
      setSaveStatus("Saving…");
      const res = await apiCall("/admin/game-events", {
        method: "POST",
        body: JSON.stringify({ gameId, events }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || "Failed to save events");
      }
      setSaveStatus("Saved ✅");
      setTimeout(() => setSaveStatus(null), 1200);
    } catch (e) {
      setSaveStatus(e instanceof Error ? e.message : "Failed to save events");
    }
  }

  async function finalizeGame(gameId: number) {
    setFinalizeStatus(null);
    try {
      setFinalizeStatus("Finalizing (autosubs + formation rules)…");
      const res = await apiCall("/admin/finalize-game", {
        method: "POST",
        body: JSON.stringify({ gameId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any).error || "Failed to finalize game");
      }
      const data = await res.json();
      setFinalizeResults(data.results ?? []);
      setFinalizeStatus("Finalized ✅");
      setTimeout(() => setFinalizeStatus(null), 1500);
    } catch (e) {
      setFinalizeStatus(e instanceof Error ? e.message : "Failed to finalize");
    }
  }

  // ✅ NEW: finalize whole round by calling existing /admin/finalize-game for every game in round
  async function finalizeSelectedRound() {
    if (selectedRound === "all") return;
    const round = selectedRound;

    setFinalizeRoundStatus(null);
    setFinalizeRoundResults([]);
    setFinalizeStatus(null);
    setFinalizeResults([]);

    const games = fixturesForSelectedRoundOnly;
    if (games.length === 0) {
      setFinalizeRoundStatus(`No games found for round ${round}.`);
      return;
    }

    try {
      setFinalizeRoundStatus(`Finalizing round ${round}… (${games.length} games)`);
      const totals = new Map<string, number>();

      for (let i = 0; i < games.length; i++) {
        const gameId = games[i].id;

        setFinalizeRoundStatus(`Finalizing round ${round}: game ${i + 1}/${games.length} (id ${gameId})…`);

        const res = await apiCall("/admin/finalize-game", {
          method: "POST",
          body: JSON.stringify({ gameId }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error((data as any).error || `Failed to finalize game ${gameId}`);
        }

        const data = await res.json();
        const rows = (data.results ?? []) as Array<{ username: string; points: number }>;

        for (const r of rows) {
          totals.set(r.username, (totals.get(r.username) ?? 0) + (r.points ?? 0));
        }
      }

      const out = Array.from(totals.entries())
        .map(([username, gwPoints]) => ({ username, gwPoints }))
        .sort((a, b) => b.gwPoints - a.gwPoints || a.username.localeCompare(b.username));

      setFinalizeRoundResults(out);
      setFinalizeRoundStatus(`Round ${round} finalized ✅`);
      setTimeout(() => setFinalizeRoundStatus(null), 2000);
    } catch (e) {
      setFinalizeRoundStatus(e instanceof Error ? e.message : "Failed to finalize round");
    }
  }

  function getEv(pid: number): PlayerEventInput {
    return events[String(pid)] ?? DEFAULT_EVENT;
  }

  function setEv(pid: number, next: PlayerEventInput) {
    setEvents((prev) => ({ ...prev, [String(pid)]: next }));
  }

  const EventRow = ({ p }: { p: Player }) => {
    const ev = getEv(p.id);
    const pts = calcPoints(p.position, ev);

    return (
      <div
        className="admin-row"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(100px, 170px) 70px 180px 100px",
          gap: 8,
          alignItems: "center",
          padding: "8px 0",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {p.name}
          </div>
          <div style={{ fontSize: 12, opacity: 0.75 }}>
            {teamsById.get(p.teamId)?.name ?? p.teamId} — {p.position}
          </div>
        </div>

        <div>
          <label style={{ fontSize: 12, opacity: 0.75 }}>Minuutit</label>
          <select
            className="admin-score-select"
            value={ev.minutes}
            onChange={(e) => setEv(p.id, { ...ev, minutes: e.target.value as MinutesBucket })}
            style={{ width: "100%" }}
          >
            <option value="0">0</option>
            <option value="1_59">1-59</option>
            <option value="60+">60+</option>
          </select>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          <div>
            <label style={{ fontSize: 12, opacity: 0.75 }}>G</label>
            <input
              className="admin-score-input"
              value={String(ev.goals)}
              onChange={(e) => setEv(p.id, { ...ev, goals: toInt(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, opacity: 0.75 }}>A</label>
            <input
              className="admin-score-input"
              value={String(ev.assists)}
              onChange={(e) => setEv(p.id, { ...ev, assists: toInt(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, opacity: 0.75 }}>KK</label>
            <input
              className="admin-score-input"
              value={String(ev.yellow)}
              onChange={(e) => setEv(p.id, { ...ev, yellow: toInt(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, opacity: 0.75 }}>PK</label>
            <input
              className="admin-score-input"
              value={String(ev.red)}
              onChange={(e) => setEv(p.id, { ...ev, red: toInt(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr) 0.9fr", gap: 6, alignItems: "end" }}>
          <div>
            <label style={{ fontSize: 12, opacity: 0.75 }}>NP</label>
            <input
              type="checkbox"
              checked={ev.cleanSheet}
              onChange={(e) => setEv(p.id, { ...ev, cleanSheet: e.target.checked })}
              style={{ width: 18, height: 18 }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, opacity: 0.75 }}>OM</label>
            <input
              className="admin-score-input"
              value={String(ev.ownGoals)}
              onChange={(e) => setEv(p.id, { ...ev, ownGoals: toInt(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, opacity: 0.75 }}>ERP</label>
            <input
              className="admin-score-input"
              value={String(ev.penMissed)}
              onChange={(e) => setEv(p.id, { ...ev, penMissed: toInt(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label style={{ fontSize: 12, opacity: 0.75 }}>TRP</label>
            <input
              className="admin-score-input"
              value={String(ev.penSaved)}
              onChange={(e) => setEv(p.id, { ...ev, penSaved: toInt(e.target.value) })}
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ gridColumn: "1 / -1", textAlign: "right", fontWeight: 700 }}>
            {pts} pts
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div className="app-actions">
        <button className={`app-btn ${tab === "players" ? "app-btn-active" : ""}`} onClick={() => setTab("players")}>
          Pelaajat
        </button>
        <button className={`app-btn ${tab === "fixtures" ? "app-btn-active" : ""}`} onClick={() => setTab("fixtures")}>
          Ottelut
        </button>
        <button className={`app-btn ${tab === "score" ? "app-btn-active" : ""}`} onClick={() => setTab("score")}>
          Otteluiden pisteet
        </button>
      </div>

      {loadingBase && <div className="app-muted">Ladataan dataa…</div>}

      {tab === "players" && (
        <div className="app-card" style={{ padding: 12 }}>
          <h2 className="app-h2">Pelaajat</h2>

          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <input
              className="app-btn"
              placeholder="Hae pelaajia…"
              value={playerSearch}
              onChange={(e) => setPlayerSearch(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />

            <select
              className="app-btn"
              value={filterTeam}
              onChange={(e) => {
                const v = e.target.value;
                setFilterTeam(v === "all" ? "all" : Number(v));
              }}
              style={{ minWidth: 180 }}
              title="Suodata joukkueella"
            >
              <option value="all">Kaikki joukkueet</option>
              {teams
                .slice()
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>

            <select
              className="app-btn"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              style={{ minWidth: 190 }}
              title="Järjestä"
            >
              <option value="name_asc">Nimi A → Ö</option>
              <option value="name_desc">Nimi Ö → A</option>
              <option value="value_desc">Arvo (korkein → matalin)</option>
              <option value="value_asc">Arvo (matalin → korkein)</option>
              <option value="newest">Uusimmat ensin</option>
              <option value="oldest">Vanhimmat ensin</option>
            </select>
          </div>

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
                {filteredPlayers.slice(0, 200).map((p) => (
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

          {filteredPlayers.length > 200 && (
            <div className="app-muted" style={{ marginTop: 8 }}>
              Showing first 200 results (narrow your search to see more).
            </div>
          )}
        </div>
      )}

      {tab === "fixtures" && (
        <div className="app-card" style={{ padding: 12 }}>
          <h2 className="app-h2">Ottelut</h2>
          {fixturesErr && <div className="app-alert">{fixturesErr}</div>}

          {fixtures.length === 0 ? (
            <div className="app-muted">
              No fixtures loaded. You can still use the scoring tab and type a gameId manually.
            </div>
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
      )}

      {tab === "score" && (
        <div className="app-card" style={{ padding: 12 }}>
          <h2 className="app-h2">Pisteet</h2>
          <div className="app-muted" style={{ marginBottom: 10 }}>
            Tallenna ottelun tapahtumat ja päätä peli. Voit myös päättää koko kierroksen (kutsuu finalize-game jokaiselle ottelulle).
          </div>

          <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
            {fixtures.length > 0 && (
              <div style={{ display: "grid", gap: 8 }}>
                {/* Round selector */}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ minWidth: 70 }}>Kierros</label>
                  <select
                    className="app-btn"
                    value={selectedRound}
                    onChange={(e) => {
                      const v = e.target.value;
                      const nextRound = v === "all" ? "all" : Number(v);

                      setSelectedRound(nextRound);
                      setSelectedGameId(null);
                      setManualGameId("");
                      setEvents({});
                      setFinalizeResults([]);
                      setFinalizeRoundResults([]);
                      setFinalizeRoundStatus(null);
                    }}
                    style={{ flex: 1 }}
                  >
                    <option value="all">Kaikki</option>
                    {rounds.map((r) => (
                      <option key={r} value={r}>
                        Kierros {r}
                      </option>
                    ))}
                  </select>

                  {/* ✅ NEW button: finalize round */}
                  <button
                    className="app-btn app-btn-primary"
                    disabled={selectedRound === "all" || fixturesForSelectedRoundOnly.length === 0}
                    onClick={finalizeSelectedRound}
                    title="Finalizes every game in this round by calling /admin/finalize-game for each fixture."
                  >
                    Päätä kierros
                  </button>
                </div>

                {/* Game selector (filtered by round) */}
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <label style={{ minWidth: 70 }}>Peli</label>
                  <select
                    className="app-btn"
                    value={selectedGameId ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      const id = v ? Number(v) : null;

                      setSelectedGameId(id);
                      setManualGameId("");
                      setEvents({});
                      setFinalizeResults([]);
                    }}
                    style={{ flex: 1 }}
                    disabled={fixturesForRound.length === 0}
                  >
                    <option value="">{fixturesForRound.length === 0 ? "Ei pelejä" : "Valitse…"}</option>
                    {fixturesForRound
                      .slice()
                      .sort((a, b) => a.id - b.id)
                      .map((f) => (
                        <option key={f.id} value={f.id}>
                          {fmtFixture(f, teamsById)}
                        </option>
                      ))}
                  </select>

                  <button
                    className="app-btn"
                    disabled={!selectedGameId}
                    onClick={() => selectedGameId && loadGameEvents(selectedGameId)}
                    title="Loads saved events for this gameId"
                  >
                    Lataa
                  </button>
                </div>
              </div>
            )}

            {/* Manual fallback if fixtures missing */}
            {fixtures.length === 0 && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <label style={{ minWidth: 70 }}>PeliId</label>
                <input
                  className="app-btn"
                  value={manualGameId}
                  onChange={(e) => setManualGameId(e.target.value)}
                  placeholder="esim. 123"
                  style={{ flex: 1 }}
                />
                <button
                  className="app-btn"
                  disabled={!effectiveGameId}
                  onClick={() => effectiveGameId && loadGameEvents(effectiveGameId)}
                >
                  Lataa
                </button>
              </div>
            )}

            {loadEventsStatus && <div className="app-muted">{loadEventsStatus}</div>}
            {finalizeRoundStatus && <div className="app-muted">{finalizeRoundStatus}</div>}
          </div>

          {/* If we have a fixture, show split home/away input */}
          {selectedFixture && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: 10 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>
                  Koti: {teamsById.get(selectedFixture.homeTeamId)?.name ?? selectedFixture.homeTeamId}
                </div>
                {homePlayers.length === 0 ? (
                  <div className="app-muted">Ei pelaajia tälle joukkueelle.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {homePlayers.map((p) => (
                      <EventRow key={p.id} p={p} />
                    ))}
                  </div>
                )}
              </div>

              <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: 10 }}>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>
                  Vieras: {teamsById.get(selectedFixture.awayTeamId)?.name ?? selectedFixture.awayTeamId}
                </div>
                {awayPlayers.length === 0 ? (
                  <div className="app-muted">Ei pelaajia tälle joukkueelle.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {awayPlayers.map((p) => (
                      <EventRow key={p.id} p={p} />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* If fixture missing, allow scoring “any players” (fallback) */}
          {!selectedFixture && (
            <div style={{ border: "1px solid rgba(0,0,0,0.08)", borderRadius: 12, padding: 10, marginBottom: 12 }}>
              <div style={{ display: "grid", gap: 8 }}>
                {filteredPlayers.slice(0, 40).map((p) => (
                  <EventRow key={p.id} p={p} />
                ))}
              </div>

              {filteredPlayers.length > 40 && (
                <div className="app-muted" style={{ marginTop: 8 }}>
                  Näytetään vain 40 ensimmäistä tulosta. Rajaa hakua nähdäksesi loput.
                </div>
              )}
            </div>
          )}

          <div className="app-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              className="app-btn app-btn-primary"
              disabled={!effectiveGameId}
              onClick={() => effectiveGameId && saveGameEvents(effectiveGameId)}
            >
              Tallenna
            </button>

            <button
              className="app-btn"
              disabled={!effectiveGameId}
              onClick={() => effectiveGameId && finalizeGame(effectiveGameId)}
              title="Computes official per-user points with autosubs + formation constraints and stores it in Redis."
            >
              Päätä peli
            </button>

            {saveStatus && <span className="app-muted">{saveStatus}</span>}
            {finalizeStatus && <span className="app-muted">{finalizeStatus}</span>}
          </div>

          {finalizeResults.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3 className="app-h2">Päätetyt tulokset (peli)</h3>
              <div className="app-table-wrap">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>Käyttäjä</th>
                      <th>Pisteet</th>
                      <th>Vaihdot käytetty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finalizeResults.map((r) => (
                      <tr key={r.username}>
                        <td>{r.username}</td>
                        <td style={{ fontWeight: 800 }}>{r.points}</td>
                        <td>
                          {r.subsUsed?.length
                            ? r.subsUsed.map((id) => playerNameById.get(id) ?? `#${id}`).join(", ")
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="app-muted" style={{ marginTop: 6 }}>
                Nämä pisteet on nyt tallennettu käyttäjäkohtaisesti tälle peliId:lle.
              </div>
            </div>
          )}

          {finalizeRoundResults.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <h3 className="app-h2">Kierroksen pisteet (yhteensä)</h3>
              <div className="app-table-wrap">
                <table className="app-table">
                  <thead>
                    <tr>
                      <th>Käyttäjä</th>
                      <th>Kierrospisteet</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finalizeRoundResults.map((r) => (
                      <tr key={r.username}>
                        <td>{r.username}</td>
                        <td style={{ fontWeight: 800 }}>{r.gwPoints}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="app-muted" style={{ marginTop: 6 }}>
                Tämä lista lasketaan clientissä kutsumalla finalize-game jokaiselle kierroksen ottelulle. (Pisteet on silti tallennettu Redisissä peliId-kohtaisesti finalize-game:n toimesta.)
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}