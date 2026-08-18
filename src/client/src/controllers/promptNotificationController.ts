import type { BrowserNotificationGateway } from "../browserNotificationGateway";
import { WindowBrowserNotificationGateway } from "../browserNotificationGateway";
import { createPromptTrackingState, detectNewPrompts, forgetSessionPrompts, type PromptNotificationEvent, type PromptTrackingState } from "../promptNotifications";
import type { SessionStatus } from "../../../shared/apiTypes";

export interface PromptNotificationTarget {
  machineId: string;
  sessionId: string;
}

export interface PromptNotificationControllerDependencies {
  gateway?: BrowserNotificationGateway;
  /** Invoked when the user clicks a notification; expected to focus/select that session. */
  onActivate: (target: PromptNotificationTarget) => void;
  onBackgroundError?: (message: string, error: unknown) => void;
}

/**
 * Watches `status.update` events from every connected machine and shows a
 * browser notification the moment a session opens an `ask_user` question set
 * or an extension confirmation dialog. Session-scoped state (the pending
 * ask/dialog cards themselves) stays owned by {@link SessionController}; this
 * controller only tracks which prompt ids it has already announced, so it can
 * stay a thin, independently testable seam.
 */
export class PromptNotificationController {
  private readonly gateway: BrowserNotificationGateway;
  private readonly onActivate: (target: PromptNotificationTarget) => void;
  private readonly onBackgroundError: (message: string, error: unknown) => void;
  private readonly tracking: PromptTrackingState = createPromptTrackingState();
  private permissionRequested = false;

  constructor(deps: PromptNotificationControllerDependencies) {
    this.gateway = deps.gateway ?? new WindowBrowserNotificationGateway();
    this.onActivate = deps.onActivate;
    this.onBackgroundError = deps.onBackgroundError ?? ((message, error) => { console.warn(message, error); });
  }

  /** Requests notification permission once. Safe to call repeatedly; only the first call does anything. */
  ensurePermissionRequested(): void {
    if (this.permissionRequested) return;
    this.permissionRequested = true;
    if (!this.gateway.isSupported()) return;
    this.gateway.ensurePermission().catch((error: unknown) => {
      this.onBackgroundError("Failed to request browser notification permission", error);
    });
  }

  /** Feed one session's status; notifies for any ask or dialog opened since the last call for that session. */
  handleStatusUpdate(machineId: string, status: SessionStatus): void {
    if (!this.gateway.isSupported()) return;
    const events = detectNewPrompts(this.tracking, status);
    for (const event of events) void this.notify(machineId, event);
  }

  /** Drops tracked prompt state for a session, e.g. once it is archived, deleted, or forgotten. */
  forgetSession(sessionId: string): void {
    forgetSessionPrompts(this.tracking, sessionId);
  }

  private async notify(machineId: string, event: PromptNotificationEvent): Promise<void> {
    try {
      const permission = await this.gateway.ensurePermission();
      if (permission !== "granted") return;
      const dedupeKey = `${event.sessionId}:${event.kind}:${event.promptId}`;
      const claimed = await this.gateway.claim(dedupeKey);
      if (!claimed) return;
      this.gateway.show({
        title: event.title,
        body: event.body,
        tag: dedupeKey,
        onActivate: () => { this.onActivate({ machineId, sessionId: event.sessionId }); },
      });
    } catch (error) {
      this.onBackgroundError(`Failed to show a browser notification for session ${event.sessionId}`, error);
    }
  }
}
