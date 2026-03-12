import React from "react";
import SquadBuilder from "./squadBuilder";
import type { Player, Team } from "./squadBuilder";

export default function TransfersPage(props: {
  players: Player[];
  teams: Team[];
  squad: Player[];
  budget: number;
  isLocked: boolean;
  transferLimit: number;
  transferUsed: number;
  beforeFirstDeadline: boolean;
  onCancel: () => void;
  onSave: (payload: { squad: Player[] }) => Promise<void> | void;
}) {
  return (
    <div className="app-card">
      <SquadBuilder
        players={props.players}
        teams={props.teams}
        initialSquad={props.squad}
        budget={props.budget}
        isLocked={props.isLocked}
        transferLimit={props.transferLimit}
        transferUsed={props.transferUsed}
        transfersUnlimited={props.beforeFirstDeadline}
        onSave={(squad) => props.onSave({ squad })}
      />
    </div>
  );
}