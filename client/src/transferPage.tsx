import React from "react";
import StartingXI, { type Player, type Team } from "./StartingXI";

type Props = {
  players: Player[];
  teams: Team[];
  squad: Player[];
  budget: number;
  onCancel: () => void;
  onSave: (payload: { squad: Player[] }) => Promise<void> | void;
};

export default function TransfersPage({
  players,
  teams,
  squad,
  budget,
  onCancel,
  onSave,
}: Props) {
  return (
    <div className="app-card">
      <div className="app-actions" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button className="app-btn" onClick={onCancel}>
          Takaisin
        </button>
      </div>

      <StartingXI
        players={players}
        teams={teams}
        layout="squad15"
        hideFormation
        transfersSquad={squad}
        budget={budget}
        readOnly={false}
        onSave={(payload) => {
          if (payload.mode !== "squad15") return;
          onSave({ squad: payload.squad });
        }}
      />
    </div>
  );
}