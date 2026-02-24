// client/src/TransfersPage.tsx
import React from "react";
import StartingXI, { type Player, type Team } from "./StartingXI";

export default function TransfersPage(props: {
  players: Player[];
  teams: Team[];
  // current saved data (may be empty on first time)
  squad: Player[]; // 15-man pool
  budget: number;
  onCancel: () => void;
  onSave: (payload: { squad: Player[] }) => void; // ✅ save only squad here
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
        layout="squad15"      // ✅ 2 GK, 5 DEF, 5 MID, 3 FWD on pitch
        hideFormation={true}  // ✅ no formation in transfers
        initialSquad={props.squad}
        budget={props.budget}
        readOnly={false}
        onSave={(payload) => {
          if (payload.mode !== "squad15") return;
          props.onSave({ squad: payload.squad });
        }}
      />
    </div>
  );
}