import { describe, expect, it } from "vitest";
import { createPromptTrackingState, detectNewPrompts, forgetSessionPrompts } from "./promptNotifications";
import type { PendingAskUser, PendingExtensionDialog, SessionStatus } from "../../shared/apiTypes";

function baseStatus(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "s1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...overrides,
  };
}

function ask(askId: string, question = "Proceed?"): PendingAskUser {
  return { askId, askedAt: new Date().toISOString(), questions: [{ id: "q1", question, options: [] }] };
}

function dialog(dialogId: string, title = "Confirm"): PendingExtensionDialog {
  return { dialogId, kind: "confirm", title, askedAt: new Date().toISOString(), runScoped: false };
}

describe("detectNewPrompts", () => {
  it("emits an event for a newly opened ask", () => {
    const tracking = createPromptTrackingState();
    const events = detectNewPrompts(tracking, baseStatus({ pendingAsk: ask("a1", "Deploy now?") }));
    expect(events).toEqual([{ sessionId: "s1", kind: "ask", promptId: "a1", title: "Question waiting", body: "Deploy now?" }]);
  });

  it("does not re-emit the same open ask on a later status update", () => {
    const tracking = createPromptTrackingState();
    detectNewPrompts(tracking, baseStatus({ pendingAsk: ask("a1") }));
    const events = detectNewPrompts(tracking, baseStatus({ pendingAsk: ask("a1"), isStreaming: true }));
    expect(events).toEqual([]);
  });

  it("emits a new event when one ask is superseded by another", () => {
    const tracking = createPromptTrackingState();
    detectNewPrompts(tracking, baseStatus({ pendingAsk: ask("a1") }));
    const events = detectNewPrompts(tracking, baseStatus({ pendingAsk: ask("a2", "Second question") }));
    expect(events).toEqual([{ sessionId: "s1", kind: "ask", promptId: "a2", title: "Question waiting", body: "Second question" }]);
  });

  it("emits an event per newly opened dialog and tolerates several open at once", () => {
    const tracking = createPromptTrackingState();
    const first = detectNewPrompts(tracking, baseStatus({ pendingDialogs: [dialog("d1", "Overwrite file?")] }));
    expect(first).toEqual([{ sessionId: "s1", kind: "dialog", promptId: "d1", title: "Overwrite file?", body: "An extension needs your confirmation." }]);

    const second = detectNewPrompts(tracking, baseStatus({ pendingDialogs: [dialog("d1", "Overwrite file?"), dialog("d2", "Delete branch?")] }));
    expect(second).toEqual([{ sessionId: "s1", kind: "dialog", promptId: "d2", title: "Delete branch?", body: "An extension needs your confirmation." }]);
  });

  it("stops tracking a dialog once it is no longer open", () => {
    const tracking = createPromptTrackingState();
    detectNewPrompts(tracking, baseStatus({ pendingDialogs: [dialog("d1")] }));
    detectNewPrompts(tracking, baseStatus({ pendingDialogs: [] }));
    const events = detectNewPrompts(tracking, baseStatus({ pendingDialogs: [dialog("d1")] }));
    expect(events).toEqual([{ sessionId: "s1", kind: "dialog", promptId: "d1", title: "Confirm", body: "An extension needs your confirmation." }]);
  });

  it("truncates long ask and dialog bodies", () => {
    const tracking = createPromptTrackingState();
    const longQuestion = "x".repeat(200);
    const events = detectNewPrompts(tracking, baseStatus({ pendingAsk: ask("a1", longQuestion) }));
    expect(events[0]?.body.length).toBe(180);
    expect(events[0]?.body.endsWith("…")).toBe(true);
  });

  it("tracks sessions independently", () => {
    const tracking = createPromptTrackingState();
    detectNewPrompts(tracking, baseStatus({ sessionId: "s1", pendingAsk: ask("a1") }));
    const events = detectNewPrompts(tracking, baseStatus({ sessionId: "s2", pendingAsk: ask("a1") }));
    expect(events).toEqual([{ sessionId: "s2", kind: "ask", promptId: "a1", title: "Question waiting", body: "Proceed?" }]);
  });
});

describe("forgetSessionPrompts", () => {
  it("makes a previously seen ask notify again after forgetting", () => {
    const tracking = createPromptTrackingState();
    detectNewPrompts(tracking, baseStatus({ pendingAsk: ask("a1") }));
    forgetSessionPrompts(tracking, "s1");
    const events = detectNewPrompts(tracking, baseStatus({ pendingAsk: ask("a1") }));
    expect(events).toHaveLength(1);
  });
});
