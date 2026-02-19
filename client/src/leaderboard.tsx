// client/src/Leaderboard.tsx
import { useEffect, useState } from "react";
import { apiCall } from "./api";

type LeaderboardRow = {
  username: string;
  points: number;
};

export default function Leaderboard() {
  const [rows, setRows] = useState<LeaderboardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoading(true);
        setError(null);

        // IMPORTANT: apiCall already prefixes "/api"
        const resp = await apiCall("/leaderboard", { method: "GET" });

        if (!alive) return;

        if (!resp.ok) {
          const text = await resp.text().catch(() => "");
          setError(`Leaderboard request failed (${resp.status}). ${text}`);
          setRows([]);
          return;
        }

        const json = (await resp.json()) as any;

        // Accept common shapes:
        // 1) { rows: [...] }
        // 2) { data: [...] }
        // 3) [ ... ]
        const list = Array.isArray(json) ? json : json?.rows ?? json?.data ?? [];

        setRows(Array.isArray(list) ? list : []);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message ?? "Failed to load leaderboard");
      } finally {
        if (!alive) return;
        setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <div style={{ padding: 12 }}>Loading leaderboard…</div>;
  if (error) return <div style={{ padding: 12 }}>Error: {error}</div>;

  const sorted = rows
    .slice()
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0));

  return (
    <div style={{ padding: 12 }}>
      <h2>Leaderboard</h2>

      {sorted.length === 0 ? (
        <div>No scores yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>#</th>
              <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #ddd" }}>User</th>
              <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #ddd" }}>Points</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, idx) => (
              <tr key={r.username ?? idx}>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{idx + 1}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.username}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee", textAlign: "right" }}>
                  {r.points ?? 0}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
