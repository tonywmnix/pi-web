import { describe, expect, it, vi } from "vitest";
import { VoiceStreamingSpeechController } from "./voiceStreamingSpeechController";

describe("VoiceStreamingSpeechController", () => {
  function createController() {
    const deps = {
      isStreamingPreferred: vi.fn(() => true),
      isAwaitingVoiceReply: vi.fn(() => true),
      isVoiceStreamActive: vi.fn(() => true),
      beginVoiceStream: vi.fn(),
      streamVoiceChunk: vi.fn(),
      finishVoiceStream: vi.fn(),
    };
    const controller = new VoiceStreamingSpeechController(deps);
    return { controller, deps };
  }

  it("does nothing when isSessionStreaming is false", () => {
    const { controller, deps } = createController();

    controller.sync(false, "Some text");

    expect(deps.beginVoiceStream).not.toHaveBeenCalled();
    expect(deps.streamVoiceChunk).not.toHaveBeenCalled();
  });

  it("does nothing when inProgressAssistantText is undefined", () => {
    const { controller, deps } = createController();

    controller.sync(true, undefined);

    expect(deps.beginVoiceStream).not.toHaveBeenCalled();
    expect(deps.streamVoiceChunk).not.toHaveBeenCalled();
  });

  it("does nothing when voice mode is not awaiting a reply", () => {
    const { controller, deps } = createController();
    deps.isAwaitingVoiceReply.mockReturnValue(false);

    controller.sync(true, "Some text");

    expect(deps.beginVoiceStream).not.toHaveBeenCalled();
    expect(deps.streamVoiceChunk).not.toHaveBeenCalled();
  });

  it("does nothing when the provider does not want streaming", () => {
    const { controller, deps } = createController();
    deps.isStreamingPreferred.mockReturnValue(false);

    controller.sync(true, "Some text");

    expect(deps.beginVoiceStream).not.toHaveBeenCalled();
    expect(deps.streamVoiceChunk).not.toHaveBeenCalled();
  });

  it("calls beginVoiceStream exactly once across multiple sync calls for the same turn", () => {
    const { controller, deps } = createController();

    controller.sync(true, "Hello there.");
    controller.sync(true, "Hello there. And more.");
    controller.sync(true, "Hello there. And more. Even more.");

    expect(deps.beginVoiceStream).toHaveBeenCalledTimes(1);
  });

  it("streams completed sentences as chunks across multiple sync calls", () => {
    const { controller, deps } = createController();

    controller.sync(true, "Hello there.");

    expect(deps.streamVoiceChunk).toHaveBeenCalledWith("Hello there.");

    controller.sync(true, "Hello there. And more");

    expect(deps.streamVoiceChunk).toHaveBeenCalledTimes(1);

    controller.sync(true, "Hello there. And more.");

    expect(deps.streamVoiceChunk).toHaveBeenCalledTimes(2);
    expect(deps.streamVoiceChunk).toHaveBeenCalledWith("And more.");
  });

  it("returns false from finishTurn when no streaming turn is in progress", () => {
    const { controller, deps } = createController();

    const result = controller.finishTurn();

    expect(result).toBe(false);
    expect(deps.streamVoiceChunk).not.toHaveBeenCalled();
    expect(deps.finishVoiceStream).not.toHaveBeenCalled();
  });

  it("flushes non-empty remainder and calls finishVoiceStream when turn finishes", () => {
    const { controller, deps } = createController();

    controller.sync(true, "Hello there. And more");
    deps.streamVoiceChunk.mockClear();

    const result = controller.finishTurn();

    expect(result).toBe(true);
    expect(deps.streamVoiceChunk).toHaveBeenCalledWith("And more");
    expect(deps.finishVoiceStream).toHaveBeenCalled();
  });

  it("does not call streamVoiceChunk again when remainder is empty/whitespace-only", () => {
    const { controller, deps } = createController();

    controller.sync(true, "Hello there.");
    deps.streamVoiceChunk.mockClear();

    const result = controller.finishTurn();

    expect(result).toBe(true);
    expect(deps.streamVoiceChunk).not.toHaveBeenCalled();
    expect(deps.finishVoiceStream).toHaveBeenCalled();
  });

  it("resets state after finishTurn so a new turn starts fresh", () => {
    const { controller, deps } = createController();

    controller.sync(true, "First turn.");
    controller.finishTurn();
    deps.beginVoiceStream.mockClear();
    deps.streamVoiceChunk.mockClear();

    controller.sync(true, "New reply.");

    expect(deps.beginVoiceStream).toHaveBeenCalledTimes(1);
    expect(deps.streamVoiceChunk).toHaveBeenCalledWith("New reply.");
  });

  it("self-resets when isVoiceStreamActive reports false mid-stream", () => {
    const { controller, deps } = createController();

    controller.sync(true, "Hello there.");
    deps.isVoiceStreamActive.mockReturnValue(false);
    deps.streamVoiceChunk.mockClear();

    controller.sync(true, "Hello there. More text.");

    expect(deps.streamVoiceChunk).not.toHaveBeenCalled();
  });

  it("recovers correctly after external toggle-off mid-stream", () => {
    const { controller, deps } = createController();

    controller.sync(true, "Hello there.");
    deps.isVoiceStreamActive.mockReturnValue(false);
    controller.sync(true, "Hello there. More text.");
    
    deps.isVoiceStreamActive.mockReturnValue(true);
    deps.beginVoiceStream.mockClear();
    deps.streamVoiceChunk.mockClear();

    controller.sync(true, "Brand new turn.");

    expect(deps.beginVoiceStream).toHaveBeenCalledTimes(1);
    expect(deps.streamVoiceChunk).toHaveBeenCalledWith("Brand new turn.");
  });
});
