import React from "react";
import SquadBuilder from "./squadBuilder";
import type { Player, Team } from "./squadBuilder";

export default function TransfersPage(props: {
  players: Player[];
  teams: Team[];
  squad: Player[];
  budget: number;
  onCancel: () => void;
  onSave: (payload: { squad: Player[] }) => void | Promise<void>;
}) {
  return (
    <div className="app-card">
      <div className="app-actions" style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button className="app-btn" onClick={props.onCancel}>
          Takaisin
        </button>
      </div>

      <SquadBuilder
        players={props.players}
        teams={props.teams}
        initialSquad={props.squad}
        budget={props.budget}
        onSave={(squad) => props.onSave({ squad })}
      />
    </div>
  );
}