import {
  createAssistantMessageTrackingState,
  detectFinishedAssistantMessage,
  forgetAssistantMessageTracking,
  type ObservedAssistantMessageEvent,
} from "../assistantMessageObservations";
import type { ChatLine } from "../components/shared";
import type { SessionStatus } from "../../../shared/apiTypes";

export interface AssistantMessageObserverDependencies {
  onMessage: (event: ObservedAssistantMessageEvent) => void;
}

/**
 * Feeds status updates for the *currently selected* session \u2014 the only one
 * whose transcript is loaded client-side \u2014 and calls `onMessage` once per
 * turn that finishes with a readable assistant message. Callers are
 * responsible for only calling {@link handleStatusUpdate} with the currently
 * selected session's status and transcript; see
 * {@link detectFinishedAssistantMessage} for the pure detection logic this
 * wraps.
 */
export class AssistantMessageObserverController {
  private readonly onMessage: (event: ObservedAssistantMessageEvent) => void;
  private readonly tracking = createAssistantMessageTrackingState();

  constructor(deps: AssistantMessageObserverDependencies) {
    this.onMessage = deps.onMessage;
  }

  handleStatusUpdate(status: SessionStatus, messages: readonly ChatLine[]): void {
    const event = detectFinishedAssistantMessage(this.tracking, status, messages);
    if (event !== undefined) this.onMessage(event);
  }

  /** Drops tracked busy state for a session, e.g. once it is archived, deleted, or forgotten. */
  forgetSession(sessionId: string): void {
    forgetAssistantMessageTracking(this.tracking, sessionId);
  }
}
