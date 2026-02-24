import React from "react";
import StartingXI, { type Player, type Team } from "./StartingXI";

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
      <div className="app-actions" style={{ marginBottom: 10, display: "flex", gap: 8 }}>
        <button className="app-btn" onClick={props.onCancel}>
          Takaisin
        </button>
      </div>

      <StartingXI
        players={props.players}
        teams={props.teams}
        // transfers = 15 slots on field (2/5/5/3), no bench UI, no formation
        layout="squad15"
        hideFormation={true}
        // seed from current saved team (xi + bench)
        initial={props.startingXI}
        initialBench={props.bench}
        budget={props.budget}
        readOnly={false}
        onSave={(payload) => {
          // payload from squad15 builder is guaranteed to be { startingXI, bench } (formation omitted)
          props.onSave({ startingXI: payload.startingXI, bench: payload.bench });
        }}
      />
    </div>
  );
}