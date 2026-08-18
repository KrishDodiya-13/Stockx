/**
 * Feed connection state.
 *
 * Surfaced in the UI because a trading screen showing a stale price without
 * saying so is worse than one showing no price at all.
 */

export type ConnectionState =
  /** No feed wanted yet — nothing subscribed. */
  | "idle"
  /** First connection attempt in flight. */
  | "connecting"
  /** Receiving data. */
  | "connected"
  /** Dropped; a retry is scheduled. */
  | "reconnecting"
  /** Gave up, or the provider is not configured. */
  | "offline";

export interface ConnectionStatus {
  readonly state: ConnectionState;
  /** Human-readable reason, shown on hover/aria-label. */
  readonly detail: string;
  /** Epoch ms of the last message actually received, if any. */
  readonly lastMessageAt: number | null;
  /** How many consecutive reconnects have been attempted. */
  readonly retryCount: number;
}

export const IDLE_CONNECTION: ConnectionStatus = {
  state: "idle",
  detail: "Not connected — nothing is subscribed yet.",
  lastMessageAt: null,
  retryCount: 0,
};

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: "Idle",
  connecting: "Connecting",
  connected: "Live",
  reconnecting: "Reconnecting",
  offline: "Offline",
};
