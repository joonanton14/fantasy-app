import { useEffect, useState } from "react";
import { apiCall } from "./api";

type Row = { username: string; total: number; last: number };
type LeaderboardResp = { rows: Row[]; gamesFinalized: number; lastGameId: number | null };

export default function Leaderboard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [gamesFinalized, setGamesFinalized] = useState<number>(0);
  const [lastGameId, setLastGameId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await apiCall("/leaderboard", { method: "GET" });
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Leaderboard failed: ${res.status} ${text}`);
        }

        const data: LeaderboardResp = await res.json();
        if (cancelled) return;

        setRows(Array.isArray(data.rows) ? data.rows : []);
        setGamesFinalized(Number(data.gamesFinalized ?? 0));
        setLastGameId(data.lastGameId ?? null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? "Failed to load leaderboard");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div style={{ padding: 16 }}>Loading leaderboard…</div>;
  if (error) return <div style={{ padding: 16, color: "red" }}>{error}</div>;

  return (
    <div style={{ padding: 16 }}>
      <h2>Tulostaulu</h2>

      <div style={{ opacity: 0.8, marginBottom: 12 }}>
        Finalized games: {gamesFinalized}
        {lastGameId ? <> • Last game: {lastGameId}</> : null}
      </div>

      {rows.length === 0 ? (
        <div>No leaderboard data yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>#</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>User</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>
                Last{lastGameId ? ` (Game ${lastGameId})` : ""}
              </th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={r.username}>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{idx + 1}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.username}</td>
                <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>{r.last}</td>
                <td style={{ padding: 8, textAlign: "right", borderBottom: "1px solid #eee" }}>{r.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}