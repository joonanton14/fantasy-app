// client/src/TransfersPage.tsx
import React from "react";
import { StartingXI, Player, Team } from "./StartingXI";

export default function TransfersPage(props: {
  players: Player[];
  teams: Team[];
  startingXI: Player[];
  bench: Player[];
  budget: number;
  onCancel: () => void;
  onSave: (payload: { startingXI: Player[]; bench: Player[] }) => void;
}) {
  return (
    <div className="app-card">
      <div className="app-section-header" style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <h2 className="app-h2" style={{ margin: 0 }}>Vaihdot</h2>
        <button className="app-btn" onClick={props.onCancel}>
          Peruuta
        </button>
      </div>

      {/* ✅ Transfers: show 15 fixed slots by position. No bench UI. No formation UI. */}
      <StartingXI
        players={props.players}
        teams={props.teams}
        initial={props.startingXI}
        initialBench={props.bench}
        budget={props.budget}
        readOnly={false}
        onSave={props.onSave}
        layout="squad15"
        hideFormation={true}
      />
    </div>
  );
}