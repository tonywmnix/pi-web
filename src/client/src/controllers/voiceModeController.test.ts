import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceModeController } from "./voiceModeController";

describe("VoiceModeController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createControllerWithFakes() {
    let capturedHandlers: { onResult: (transcript: string, isFinal: boolean) => void } | undefined;

    const startListening = vi.fn((handlers: { onResult: (transcript: string, isFinal: boolean) => void }) => {
      capturedHandlers = handlers;
      return { stop: vi.fn() };
    });
    const speak = vi.fn();
    const stopSpeaking = vi.fn();
    const onTranscriptReady = vi.fn();
    const onStateChange = vi.fn();

    const controller = new VoiceModeController({
      startListening,
      speak,
      stopSpeaking,
      onTranscriptReady,
      onStateChange,
    });

    return {
      controller,
      startListening,
      speak,
      stopSpeaking,
      onTranscriptReady,
      onStateChange,
      getCapturedHandlers: () => capturedHandlers,
    };
  }

  it("toggle() from fresh controller starts listening", () => {
    const { controller, startListening, onStateChange } = createControllerWithFakes();

    controller.toggle();

    expect(startListening).toHaveBeenCalled();
    expect(onStateChange).toHaveBeenCalled();
  });

  it("toggle() while listening turns voice mode off", () => {
    const { controller, stopSpeaking } = createControllerWithFakes();

    controller.toggle();
    stopSpeaking.mockClear();

    controller.toggle();

    expect(stopSpeaking).toHaveBeenCalled();
  });

  it("dispose() calls stopSpeaking", () => {
    const { controller, stopSpeaking } = createControllerWithFakes();

    controller.toggle();
    stopSpeaking.mockClear();

    controller.dispose();

    expect(stopSpeaking).toHaveBeenCalled();
  });

  it("provides currentState accessor", () => {
    const { controller } = createControllerWithFakes();

    expect(controller.currentState.kind).toBe("off");

    controller.toggle();

    expect(controller.currentState.kind).toBe("listening");
  });

  it("cancel() resets listening state", () => {
    const { controller } = createControllerWithFakes();

    controller.toggle();
    expect(controller.currentState.kind).toBe("listening");

    controller.cancel();

    expect(controller.currentState.kind).toBe("listening");
  });

  it("replyReceived() transitions to speaking state", () => {
    const { controller, speak, getCapturedHandlers } = createControllerWithFakes();

    controller.toggle();
    expect(controller.currentState.kind).toBe("listening");

    // Simulate the user saying something via the recognition result handler
    const handlers = getCapturedHandlers();
    expect(handlers).toBeDefined();
    
    // Simulate the user saying "hello world"
    handlers?.onResult("hello world", false);
    expect(controller.currentState.kind).toBe("listening");
    
    // Simulate silence timeout, which transitions to awaiting-reply
    vi.advanceTimersByTime(1000);
    expect(controller.currentState.kind).toBe("awaiting-reply");

    // Now call replyReceived to transition to speaking
    controller.replyReceived("hello world");
    expect(controller.currentState.kind).toBe("speaking");

    expect(speak).toHaveBeenCalledWith("hello world", expect.any(Function));
  });
});
