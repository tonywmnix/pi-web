import { describe, expect, it } from "vitest";
import { createAssistantMessageTrackingState, detectFinishedAssistantMessage, forgetAssistantMessageTracking } from "./assistantMessageObservations";
import type { ChatLine } from "./components/shared";
import type { SessionStatus } from "../../shared/apiTypes";

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

function assistantText(text: string): ChatLine {
  return { role: "assistant", parts: [{ type: "text", text }] };
}

function userText(text: string): ChatLine {
  return { role: "user", parts: [{ type: "text", text }] };
}

function toolOnlyMessage(role: ChatLine["role"]): ChatLine {
  return { role, parts: [{ type: "toolExecution", toolCallId: "t1", toolName: "bash", summary: "Ran bash", status: "success" }] };
}

describe("detectFinishedAssistantMessage", () => {
  it("emits nothing on the first status seen for a session, even if idle", () => {
    const tracking = createAssistantMessageTrackingState();
    const event = detectFinishedAssistantMessage(tracking, baseStatus(), [assistantText("Hello")]);
    expect(event).toBeUndefined();
  });

  it("emits nothing while still busy", () => {
    const tracking = createAssistantMessageTrackingState();
    detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: true }), []);
    const event = detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: true }), [assistantText("partial")]);
    expect(event).toBeUndefined();
  });

  it("emits the last assistant message's plain text on a busy -> idle transition", () => {
    const tracking = createAssistantMessageTrackingState();
    detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: true }), []);
    const event = detectFinishedAssistantMessage(
      tracking,
      baseStatus({ isStreaming: false }),
      [userText("hi"), assistantText("Hello there!")],
    );
    expect(event).toEqual({ sessionId: "s1", index: 1, text: "Hello there!" });
  });

  it("does not re-emit on a later idle status update with no new turn", () => {
    const tracking = createAssistantMessageTrackingState();
    detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: true }), []);
    detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: false }), [assistantText("Hello")]);
    const event = detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: false }), [assistantText("Hello")]);
    expect(event).toBeUndefined();
  });

  it("treats bash-running and compacting as busy too", () => {
    const tracking = createAssistantMessageTrackingState();
    detectFinishedAssistantMessage(tracking, baseStatus({ isBashRunning: true }), []);
    const bashDone = detectFinishedAssistantMessage(tracking, baseStatus({ isBashRunning: false }), [assistantText("Ran it")]);
    expect(bashDone).toEqual({ sessionId: "s1", index: 0, text: "Ran it" });

    detectFinishedAssistantMessage(tracking, baseStatus({ isCompacting: true }), [assistantText("Ran it")]);
    const compactDone = detectFinishedAssistantMessage(
      tracking,
      baseStatus({ isCompacting: false }),
      [assistantText("Ran it"), assistantText("Compacted, continuing.")],
    );
    expect(compactDone).toEqual({ sessionId: "s1", index: 1, text: "Compacted, continuing." });
  });

  it("does not fall back to an older assistant message when the most recent one has no text (e.g. a bare tool call) — that older message was already announced on a prior turn", () => {
    const tracking = createAssistantMessageTrackingState();
    detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: true }), []);
    const toolOnly = toolOnlyMessage("assistant");
    const event = detectFinishedAssistantMessage(
      tracking,
      baseStatus({ isStreaming: false }),
      [assistantText("Here's the plan."), toolOnly],
    );
    expect(event).toBeUndefined();
  });

  it("skips a trailing non-assistant (tool) transcript line to find the last assistant message", () => {
    const tracking = createAssistantMessageTrackingState();
    detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: true }), []);
    const toolResult = toolOnlyMessage("tool");
    const event = detectFinishedAssistantMessage(
      tracking,
      baseStatus({ isStreaming: false }),
      [assistantText("Running that now."), toolResult],
    );
    expect(event).toEqual({ sessionId: "s1", index: 0, text: "Running that now." });
  });

  it("emits nothing when the turn finished without any assistant message", () => {
    const tracking = createAssistantMessageTrackingState();
    detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: true }), []);
    const event = detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: false }), [userText("hi")]);
    expect(event).toBeUndefined();
  });

  it("tracks sessions independently by sessionId", () => {
    const tracking = createAssistantMessageTrackingState();
    detectFinishedAssistantMessage(tracking, baseStatus({ sessionId: "a", isStreaming: true }), []);
    detectFinishedAssistantMessage(tracking, baseStatus({ sessionId: "b", isStreaming: true }), []);
    const aDone = detectFinishedAssistantMessage(tracking, baseStatus({ sessionId: "a", isStreaming: false }), [assistantText("A's reply")]);
    const bStillBusy = detectFinishedAssistantMessage(tracking, baseStatus({ sessionId: "b", isStreaming: true }), [assistantText("not yet")]);
    expect(aDone).toEqual({ sessionId: "a", index: 0, text: "A's reply" });
    expect(bStillBusy).toBeUndefined();
  });

  it("forgetAssistantMessageTracking drops a session so its next status is treated as first-seen", () => {
    const tracking = createAssistantMessageTrackingState();
    detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: true }), []);
    forgetAssistantMessageTracking(tracking, "s1");
    const event = detectFinishedAssistantMessage(tracking, baseStatus({ isStreaming: false }), [assistantText("Hello")]);
    expect(event).toBeUndefined();
  });
});
