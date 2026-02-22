// client/src/TransfersPage.tsx
import React from "react";
import StartingXI from "./StartingXI";

type Player = {
  id: number;
  name: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  teamId: number;
  value: number;
};

type Team = { id: number; name: string };

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
      <div className="app-section-header" style={{ marginBottom: 12 }}>
        <div style={{ display: "grid", gap: 4 }}>
          <h2 className="app-h2">Siirrot</h2>
          <div className="app-muted" style={{ textAlign: "left" }}>
            Paina pelaajaa → poista (×) → valitse uusi pelaaja.
          </div>
        </div>

        <div className="app-actions">
          <button className="app-btn" onClick={props.onCancel}>
            Takaisin
          </button>
        </div>
      </div>

      <StartingXI
        players={props.players}
        teams={props.teams}
        initial={props.startingXI}
        initialBench={props.bench}
        budget={props.budget}
        readOnly={false}
        onSave={props.onSave}
      />
    </div>
  );
}