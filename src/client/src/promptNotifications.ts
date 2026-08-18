import type { PendingAskUser, PendingExtensionDialog, SessionStatus } from "../../shared/apiTypes";

/** One newly opened prompt, or one completed turn, worth surfacing as a browser notification. */
export interface PromptNotificationEvent {
  sessionId: string;
  kind: "ask" | "dialog" | "done";
  /**
   * The ask id, dialog id, or (for `"done"`) a synthetic per-completion id;
   * unique within a running daemon, used as the cross-tab dedupe key together
   * with `sessionId`.
   */
  promptId: string;
  title: string;
  body: string;
}

interface SessionPromptSnapshot {
  askId: string | undefined;
  dialogIds: ReadonlySet<string>;
  /** Whether the session was mid-turn (streaming, running bash, or compacting) as of the last status seen. */
  wasBusy: boolean;
  /** Count of turns completed so far, used to mint a unique `promptId` for each `"done"` event. */
  doneCount: number;
}

/** Per-tab tracking of the prompts already seen for each session, across every machine. */
export type PromptTrackingState = Map<string, SessionPromptSnapshot>;

export function createPromptTrackingState(): PromptTrackingState {
  return new Map();
}

/**
 * Diffs a session's freshly received status against what this tab last saw for
 * that session and returns one event per newly opened ask or dialog. Mutates
 * `tracking` in place so the next call sees this status as the baseline.
 *
 * Ask ids are compared against the single open ask (asks never overlap, a new
 * one supersedes the last); dialog ids are compared against the full open set,
 * since several dialogs may be open on one session at once.
 */
export function detectNewPrompts(tracking: PromptTrackingState, status: SessionStatus): PromptNotificationEvent[] {
  const previous = tracking.get(status.sessionId);
  const events: PromptNotificationEvent[] = [];

  const nextAskId = status.pendingAsk?.askId;
  if (nextAskId !== undefined && nextAskId !== previous?.askId && status.pendingAsk !== undefined) {
    events.push(askPromptEvent(status.sessionId, status.pendingAsk));
  }

  const previousDialogIds = previous?.dialogIds ?? EMPTY_DIALOG_IDS;
  const nextDialogs = status.pendingDialogs ?? [];
  for (const dialog of nextDialogs) {
    if (!previousDialogIds.has(dialog.dialogId)) events.push(dialogPromptEvent(status.sessionId, dialog));
  }

  const isBusy = status.isStreaming || status.isBashRunning || status.isCompacting;
  // Only announce a finished turn when nothing else was just opened for it to
  // report on (a turn that ends by asking a question is already covered above).
  const turnJustFinished = previous?.wasBusy === true && !isBusy && events.length === 0;
  const doneCount = (previous?.doneCount ?? 0) + (turnJustFinished ? 1 : 0);
  if (turnJustFinished) events.push(donePromptEvent(status.sessionId, doneCount));

  tracking.set(status.sessionId, {
    askId: nextAskId,
    dialogIds: new Set(nextDialogs.map((dialog) => dialog.dialogId)),
    wasBusy: isBusy,
    doneCount,
  });
  return events;
}

/** Forgets a session's tracked prompts, e.g. once it is archived or removed from view. */
export function forgetSessionPrompts(tracking: PromptTrackingState, sessionId: string): void {
  tracking.delete(sessionId);
}

const EMPTY_DIALOG_IDS: ReadonlySet<string> = new Set();
const NOTIFICATION_BODY_MAX_LENGTH = 180;

function askPromptEvent(sessionId: string, ask: PendingAskUser): PromptNotificationEvent {
  const first = ask.questions[0];
  const extra = ask.questions.length > 1 ? ` (+${String(ask.questions.length - 1)} more)` : "";
  return {
    sessionId,
    kind: "ask",
    promptId: ask.askId,
    title: "Question waiting",
    body: `${truncateBody(first?.question ?? "The agent has a question for you.")}${extra}`,
  };
}

function dialogPromptEvent(sessionId: string, dialog: PendingExtensionDialog): PromptNotificationEvent {
  return {
    sessionId,
    kind: "dialog",
    promptId: dialog.dialogId,
    title: dialog.title === "" ? "Confirmation needed" : dialog.title,
    body: truncateBody(dialog.message ?? "An extension needs your confirmation."),
  };
}

function donePromptEvent(sessionId: string, doneCount: number): PromptNotificationEvent {
  return {
    sessionId,
    kind: "done",
    promptId: `done-${String(doneCount)}`,
    title: "pi-web is done",
    body: "The agent finished its turn and is waiting for you.",
  };
}

function truncateBody(text: string): string {
  return text.length > NOTIFICATION_BODY_MAX_LENGTH ? `${text.slice(0, NOTIFICATION_BODY_MAX_LENGTH - 1)}…` : text;
}
