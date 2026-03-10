import React from "react";
import SquadBuilder from "./squadBuilder";
import type { Player, Team } from "./squadBuilder";

export default function TransfersPage(props: {
  players: Player[];
  teams: Team[];
  squad: Player[];
  budget: number;
  isLocked?: boolean;
  onCancel: () => void;
  onSave: (payload: { squad: Player[] }) => void | Promise<void>;
}) {
  return (
    <div className="app-card">
      <SquadBuilder
        players={props.players}
        teams={props.teams}
        initialSquad={props.squad}
        budget={props.budget}
        isLocked={props.isLocked}
        onSave={(squad) => props.onSave({ squad })}
      />
    </div>
  );
}