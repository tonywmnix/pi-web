import type { SessionStatus } from "./api";

/**
 * Whether a session is holding a question nobody has answered: either an
 * `ask_user` question set or an extension confirm/select/input dialog.
 */
export function statusAwaitsAnswer(status: SessionStatus | undefined): boolean {
  if (status === undefined) return false;
  return status.pendingAsk !== undefined || (status.pendingDialogs ?? []).length > 0;
}

/**
 * Decides which status updates deserve an audible alert.
 *
 * Status is republished constantly while a session streams, and the same
 * pending question rides along in every one of those updates, so the alert has
 * to fire on the *transition* into waiting rather than on the presence of a
 * question.
 *
 * The first status seen for a session is recorded silently. Opening the app, or
 * reconnecting a dropped stream, replays the current status of every live
 * session; alerting on those would greet a page load with a burst of chimes for
 * questions that have been sitting there for an hour.
 */
export class AskAttentionTracker {
  private readonly awaitingBySessionId = new Map<string, boolean>();

  /** True when this update is a fresh transition into waiting for an answer. */
  observe(status: SessionStatus): boolean {
    const awaiting = statusAwaitsAnswer(status);
    const previous = this.awaitingBySessionId.get(status.sessionId);
    this.awaitingBySessionId.set(status.sessionId, awaiting);
    if (previous === undefined) return false;
    return awaiting && !previous;
  }

  /** Drop a session so a later re-appearance is treated as a first sighting. */
  forget(sessionId: string): void {
    this.awaitingBySessionId.delete(sessionId);
  }
}
