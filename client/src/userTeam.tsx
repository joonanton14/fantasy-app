import { apiCall } from "./api";

export type SavedTeam = {
  startingXIIds?: number[];
  formation?: string;
};

export async function loadSavedTeam(): Promise<SavedTeam | null> {
  const res = await apiCall("/user-team", { method: "GET" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Failed to load saved team");
  const json = await res.json();
  return json.data ?? null;
}

export async function saveStartingXI(data: SavedTeam) {
  const res = await apiCall("/user-team", {
    method: "POST",
    body: JSON.stringify({ data }),
  });
  if (!res.ok) throw new Error("Failed to save starting XI");
}
