import React, { useEffect } from "react";
import { createPortal } from "react-dom";

type Position = "GK" | "DEF" | "MID" | "FWD";
type Player = {
  id: number;
  name: string;
  position: Position;
  teamId: number;
  value: number;
};
type Team = { id: number; name: string };

function fmtPos(pos: Position) {
  return pos === "FWD" ? "ST" : pos;
}

export default function PlayerDetailsModal(props: {
  player: Player | null;
  teams: Team[];
  onClose: () => void;
}) {
  const { player, teams, onClose } = props;

  useEffect(() => {
    if (!player) {
      document.body.style.overflow = "";
      return;
    }

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = "";
    };
  }, [player]);

  if (!player) return null;

  const teamName = teams.find((t) => t.id === player.teamId)?.name ?? "-";

  return createPortal(
    <div className="player-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true">
      <div className="player-modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="player-modal-head">
          <div className="player-modal-title">Pelaajan tiedot</div>
          <button type="button" className="player-modal-close" onClick={onClose} aria-label="Sulje">
            ✕
          </button>
        </div>

        <div className="player-modal-card">
          <div className="player-modal-name">{player.name}</div>

          <div className="player-modal-grid">
            <div className="player-modal-item">
              <div className="player-modal-label">Pelipaikka</div>
              <div className="player-modal-value">{fmtPos(player.position)}</div>
            </div>

            <div className="player-modal-item">
              <div className="player-modal-label">Joukkue</div>
              <div className="player-modal-value">{teamName}</div>
            </div>

            <div className="player-modal-item">
              <div className="player-modal-label">Arvo</div>
              <div className="player-modal-value">{player.value.toFixed(1)} M</div>
            </div>

            <div className="player-modal-item">
              <div className="player-modal-label">ID</div>
              <div className="player-modal-value">#{player.id}</div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}