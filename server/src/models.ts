export type Position = "GK" | "DEF" | "MID" | "FWD";

// Basic representation of a football player used in the fantasy game.
export interface Player {
  /**
   * Unique identifier for the player.
   */
  id: number;
  /**
   * Display name of the player.
   */
  name: string;
  /**
   * Player's position on the field (Goalkeeper, Defender, Midfielder or Forward).
   */
  position: Position;
  /**
   * ID of the team this player belongs to.
   */
  teamId: number;
  /**
   * Player's fantasy value in millions. Values are clamped between 4 and 12.
   */
  value: number;
}

// Representation of a football team.
export interface Team {
  id: number;
  name: string;
}

// Fixture ties two teams on a date. Useful for showing match schedule.
export interface Fixture {
  id: number;
  homeTeamId: number;
  awayTeamId: number;
  round: number;
  /**
   * ISO string indicating the date/time of the match.
   */
  date: string;
}

// UserTeam stores a fantasy manager's squad. In a production application you
// would persist this in a database and associate it with a user account.
export interface UserTeam {
  id: number;
  name: string;
  players: number[]; // array of player IDs
  /**
   * Remaining budget for the team.
   */
  budget: number;
}

// User represents an application user with admin privileges
export interface User {
  id: number;
  name: string;
  isAdmin: boolean;
}