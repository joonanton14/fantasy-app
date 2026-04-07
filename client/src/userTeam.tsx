import { apiCall } from "./api";

export type FormationKey = "3-5-2" | "3-4-3" | "4-4-2" | "4-3-3" | "4-5-1" | "5-3-2" | "5-4-1";

export type SavedTeamData = {
  formation?: FormationKey;
  squadIds?: number[];
  startingXIIds?: number[];
  benchIds?: number[];
  finalXIIds?: number[];
  finalBenchIds?: number[];
  finalStarPlayerIds?: {
    DEF?: number | null;
    MID?: number | null;
    FWD?: number | null;
  };
  starPlayerIds?: {
    DEF?: number | null;
    MID?: number | null;
    FWD?: number | null;
  };
  transfers?: {
    round?: number;
    used?: number;
    limit?: number;
  };
};

export type LoadSavedTeamResponse = {
  data: SavedTeamData | null;
};

export type SaveStartingXIResponse = {
  ok: true;
  data: SavedTeamData;
};

export async function loadSavedTeam(): Promise<LoadSavedTeamResponse> {
  const res = await apiCall("/user-team", { method: "GET" });
  const json = await res.json();

  if (!res.ok) {
    throw new Error((json as any)?.error || "Failed to load team");
  }

  return json as LoadSavedTeamResponse;
}

export async function saveStartingXI(data: SavedTeamData): Promise<SaveStartingXIResponse> {
  const res = await apiCall("/user-team", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error((json as any)?.error || "Failed to save team");
  }

  return json as SaveStartingXIResponse;
}