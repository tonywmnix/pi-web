import { describe, expect, it } from "vitest";
import { AssistantMessageObserverController } from "./assistantMessageObserverController";
import type { ChatLine } from "../components/shared";
import type { SessionStatus } from "../../../shared/apiTypes";

function status(overrides: Partial<SessionStatus> = {}): SessionStatus {
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

describe("AssistantMessageObserverController", () => {
  it("calls onMessage once for a finished turn with a readable assistant message", () => {
    const events: unknown[] = [];
    const controller = new AssistantMessageObserverController({ onMessage: (event) => { events.push(event); } });

    controller.handleStatusUpdate(status({ isStreaming: true }), []);
    controller.handleStatusUpdate(status({ isStreaming: false }), [assistantText("Done!")]);

    expect(events).toEqual([{ sessionId: "s1", index: 0, text: "Done!" }]);
  });

  it("does not call onMessage while still streaming, or on a redundant idle update", () => {
    const events: unknown[] = [];
    const controller = new AssistantMessageObserverController({ onMessage: (event) => { events.push(event); } });

    controller.handleStatusUpdate(status({ isStreaming: true }), []);
    controller.handleStatusUpdate(status({ isStreaming: true }), [assistantText("partial")]);
    controller.handleStatusUpdate(status({ isStreaming: false }), [assistantText("Done!")]);
    controller.handleStatusUpdate(status({ isStreaming: false }), [assistantText("Done!")]);

    expect(events).toEqual([{ sessionId: "s1", index: 0, text: "Done!" }]);
  });

  it("forgetSession resets tracking so the next status is treated as first-seen", () => {
    const events: unknown[] = [];
    const controller = new AssistantMessageObserverController({ onMessage: (event) => { events.push(event); } });

    controller.handleStatusUpdate(status({ isStreaming: true }), []);
    controller.forgetSession("s1");
    controller.handleStatusUpdate(status({ isStreaming: false }), [assistantText("Done!")]);

    expect(events).toEqual([]);
  });
});
