// client/src/TransfersPage.tsx
import React, { useMemo } from "react";
import { StartingXI, FormationKey, Player, Team } from "./StartingXI";

const FORMATIONS: Record<FormationKey, { DEF: number; MID: number; FWD: number }> = {
  "3-5-2": { DEF: 3, MID: 5, FWD: 2 },
  "3-4-3": { DEF: 3, MID: 4, FWD: 3 },
  "4-4-2": { DEF: 4, MID: 4, FWD: 2 },
  "4-3-3": { DEF: 4, MID: 3, FWD: 3 },
  "4-5-1": { DEF: 4, MID: 5, FWD: 1 },
  "5-3-2": { DEF: 5, MID: 3, FWD: 2 },
  "5-4-1": { DEF: 5, MID: 4, FWD: 1 },
};

function inferFormationFromXI(xi: Player[]): FormationKey | null {
  const gk = xi.filter((p) => p.position === "GK").length;
  const def = xi.filter((p) => p.position === "DEF").length;
  const mid = xi.filter((p) => p.position === "MID").length;
  const fwd = xi.filter((p) => p.position === "FWD").length;
  if (gk !== 1) return null;

  const hit = (Object.keys(FORMATIONS) as FormationKey[]).find((k) => {
    const f = FORMATIONS[k];
    return f.DEF === def && f.MID === mid && f.FWD === fwd;
  });

  return hit ?? null;
}

export default function TransfersPage(props: {
  players: Player[];
  teams: Team[];
  startingXI: Player[];
  bench: Player[];
  budget: number;
  onCancel: () => void;
  onSave: (payload: { startingXI: Player[]; bench: Player[] }) => void;
}) {
  const fixedFormation = useMemo<FormationKey>(
    () => inferFormationFromXI(props.startingXI) ?? "4-4-2",
    [props.startingXI]
  );

  return (
    <div className="app-card">
      <div className="app-section-header" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <h2 className="app-h2" style={{ margin: 0 }}>Vaihdot</h2>
        <button className="app-btn" onClick={props.onCancel}>Peruuta</button>
      </div>

      <StartingXI
        players={props.players}
        teams={props.teams}
        initial={props.startingXI}
        initialBench={props.bench}
        budget={props.budget}
        readOnly={false}
        onSave={props.onSave}
        mode="transfers"
        fixedFormation={fixedFormation}
        hideFormation={true}
        // showBench must be true internally so we have 4 extra slots to pick,
        // but bench section is hidden by layout="all15"
        hideBench={false}
        layout="all15" // ✅ key change: 4 bench slots go on pitch, no bench section
      />
    </div>
  );
}