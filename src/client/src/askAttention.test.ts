import { describe, expect, it } from "vitest";
import type { PendingAskUser, PendingExtensionDialog, SessionStatus } from "./api";
import { AskAttentionTracker, statusAwaitsAnswer } from "./askAttention";

const ask: PendingAskUser = {
  askId: "ask-1",
  askedAt: "2026-08-17T00:00:00.000Z",
  questions: [{ id: "q1", question: "Proceed?", options: [] }],
};
const dialog: PendingExtensionDialog = {
  dialogId: "dialog-1",
  kind: "confirm",
  title: "Continue?",
  askedAt: "2026-08-17T00:00:00.000Z",
  runScoped: true,
};

function status(sessionId: string, overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId,
    persisted: true,
    thinkingLevel: "medium",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    messageCount: 1,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...overrides,
  };
}

describe("statusAwaitsAnswer", () => {
  it("is true for an ask_user question and for an extension dialog", () => {
    expect(statusAwaitsAnswer(status("s", { pendingAsk: ask }))).toBe(true);
    expect(statusAwaitsAnswer(status("s", { pendingDialogs: [dialog] }))).toBe(true);
  });

  it("is false for a plain or absent status", () => {
    expect(statusAwaitsAnswer(status("s"))).toBe(false);
    expect(statusAwaitsAnswer(status("s", { pendingDialogs: [] }))).toBe(false);
    expect(statusAwaitsAnswer(undefined)).toBe(false);
  });
});

describe("AskAttentionTracker", () => {
  it("alerts once on the transition into waiting, not on every republish", () => {
    const tracker = new AskAttentionTracker();
    tracker.observe(status("s1"));

    expect(tracker.observe(status("s1", { pendingAsk: ask }))).toBe(true);
    // Status republishes constantly while streaming and carries the same
    // question each time; only the first may sound.
    expect(tracker.observe(status("s1", { pendingAsk: ask }))).toBe(false);
    expect(tracker.observe(status("s1", { pendingAsk: ask }))).toBe(false);
  });

  it("stays silent on the first status seen for a session", () => {
    const tracker = new AskAttentionTracker();

    // Page load and stream reconnect both replay current status for every live
    // session; a question that has been open for an hour must not chime now.
    expect(tracker.observe(status("s1", { pendingAsk: ask }))).toBe(false);
  });

  it("alerts again after the question is answered and a new one is asked", () => {
    const tracker = new AskAttentionTracker();
    tracker.observe(status("s1"));
    expect(tracker.observe(status("s1", { pendingAsk: ask }))).toBe(true);

    expect(tracker.observe(status("s1"))).toBe(false);
    expect(tracker.observe(status("s1", { pendingAsk: ask }))).toBe(true);
  });

  it("tracks sessions independently", () => {
    const tracker = new AskAttentionTracker();
    tracker.observe(status("s1"));
    tracker.observe(status("s2"));

    expect(tracker.observe(status("s1", { pendingAsk: ask }))).toBe(true);
    // s2 has its own history; s1 waiting says nothing about it.
    expect(tracker.observe(status("s2"))).toBe(false);
    expect(tracker.observe(status("s2", { pendingDialogs: [dialog] }))).toBe(true);
  });

  it("treats a forgotten session as newly seen again", () => {
    const tracker = new AskAttentionTracker();
    tracker.observe(status("s1"));
    tracker.forget("s1");

    expect(tracker.observe(status("s1", { pendingAsk: ask }))).toBe(false);
  });

  it("alerts when a confirm dialog replaces an answered question", () => {
    const tracker = new AskAttentionTracker();
    tracker.observe(status("s1"));
    expect(tracker.observe(status("s1", { pendingAsk: ask }))).toBe(true);
    expect(tracker.observe(status("s1"))).toBe(false);

    expect(tracker.observe(status("s1", { pendingDialogs: [dialog] }))).toBe(true);
  });
});
