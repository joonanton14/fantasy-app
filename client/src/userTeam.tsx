// client/src/userTeam.ts
import { apiCall } from "./api";

export type FormationKey = "3-5-2" | "3-4-3" | "4-4-2" | "4-3-3" | "4-5-1" | "5-3-2" | "5-4-1";

export type SavedTeamData = {
  squadIds?: number[];        // 15 ids saved from TransfersPage
  startingXIIds?: number[];   // 11 ids saved from StartingXI page
  benchIds?: number[];        // 4 ids saved from StartingXI page (order matters)
  formation?: FormationKey;   // saved formation
};

export async function loadSavedTeam(): Promise<SavedTeamData | null> {
  const res = await apiCall("/user-team", { method: "GET" });
  if (!res.ok) return null;
  const json = await res.json();
  return (json?.data ?? null) as SavedTeamData | null;
}

// name kept for compatibility; this saves any subset (squad / xi / bench / formation)
export async function saveStartingXI(data: SavedTeamData): Promise<void> {
  const res = await apiCall("/user-team", {
    method: "POST",
    body: JSON.stringify({ data }),
  });

  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as any)?.error || "Failed to save team");
  }
}