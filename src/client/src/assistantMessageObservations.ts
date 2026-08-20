import { messagePlainText } from "./chatMessages";
import type { ChatLine } from "./components/shared";
import type { SessionStatus } from "../../shared/apiTypes";

/** One finalized assistant message worth notifying plugin message observers about. */
export interface ObservedAssistantMessageEvent {
  sessionId: string;
  index: number;
  text: string;
}

interface SessionBusySnapshot {
  wasBusy: boolean;
}

/** Per-tab tracking of the busy/idle state last seen for each session. */
export type AssistantMessageTrackingState = Map<string, SessionBusySnapshot>;

export function createAssistantMessageTrackingState(): AssistantMessageTrackingState {
  return new Map();
}

/**
 * Diffs one session's freshly received status against what was last seen for
 * it and, on a busy -> idle transition (the turn just finished), returns the
 * plain text of the transcript's last finalized assistant message.
 *
 * Mirrors {@link detectNewPrompts}'s busy/idle diffing in
 * `promptNotifications.ts`, but returns message content instead of a
 * notification body. `messages` must be *that session's* current transcript
 * \u2014 client-side, only the currently selected session's transcript is
 * loaded, so callers should only invoke this for status updates belonging to
 * the currently selected session.
 *
 * Returns `undefined` when the turn didn't just finish, or finished without
 * a readable assistant message (e.g. it ended on a tool-only turn, or the
 * only assistant message so far has no text parts).
 */
export function detectFinishedAssistantMessage(
  tracking: AssistantMessageTrackingState,
  status: SessionStatus,
  messages: readonly ChatLine[],
): ObservedAssistantMessageEvent | undefined {
  const previous = tracking.get(status.sessionId);
  const isBusy = status.isStreaming || status.isBashRunning || status.isCompacting;
  const turnJustFinished = previous?.wasBusy === true && !isBusy;
  tracking.set(status.sessionId, { wasBusy: isBusy });
  if (!turnJustFinished) return undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = messagePlainText(message);
    return text === "" ? undefined : { sessionId: status.sessionId, index, text };
  }
  return undefined;
}

/** Forgets a session's tracked busy state, e.g. once it is archived or removed from view. */
export function forgetAssistantMessageTracking(tracking: AssistantMessageTrackingState, sessionId: string): void {
  tracking.delete(sessionId);
}
