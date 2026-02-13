import { apiCall } from "./api";

export type SavedTeamData = {
  startingXIIds: number[];
  benchIds?: number[];
};

export async function loadSavedTeam(): Promise<SavedTeamData | null> {
  const res = await apiCall("/user-team", { method: "GET" });
  if (!res.ok) return null;
  const json = await res.json();
  return (json?.data ?? null) as SavedTeamData | null;
}

export async function saveStartingXI(data: SavedTeamData) {
  const res = await apiCall("/user-team", {
    method: "POST",
    body: JSON.stringify({ data }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as any)?.error || "Failed to save team");
  }
}
