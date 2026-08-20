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
    let latestStop: ReturnType<typeof vi.fn> | undefined;

    const startListening = vi.fn((handlers: { onResult: (transcript: string, isFinal: boolean) => void }) => {
      capturedHandlers = handlers;
      const stop = vi.fn();
      latestStop = stop;
      return { stop };
    });
    const speak = vi.fn<(text: string, onDone: () => void) => void>();
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
      getLatestStop: () => latestStop,
    };
  }

  it("toggle() from fresh controller starts listening", () => {
    const { controller, startListening, onStateChange } = createControllerWithFakes();

    controller.toggle();

    expect(startListening).toHaveBeenCalled();
    expect(onStateChange).toHaveBeenCalled();
  });

  it("toggle() while listening turns voice mode off and stops the mic", () => {
    const { controller, stopSpeaking, getLatestStop } = createControllerWithFakes();

    controller.toggle();
    const stop = getLatestStop();
    stopSpeaking.mockClear();

    controller.toggle();

    expect(controller.currentState.kind).toBe("off");
    expect(stop).toHaveBeenCalled();
    expect(stopSpeaking).toHaveBeenCalled();
  });

  it("toggle() while speaking turns voice mode off without further speak/startListening calls", () => {
    const { controller, speak, stopSpeaking, startListening, getCapturedHandlers } = createControllerWithFakes();

    controller.toggle();
    getCapturedHandlers()?.onResult("hello world", false);
    vi.advanceTimersByTime(1000);
    controller.replyReceived("hi there");
    expect(controller.currentState.kind).toBe("speaking");

    const startListeningCallsBeforeToggleOff = startListening.mock.calls.length;
    const speakCallsBeforeToggleOff = speak.mock.calls.length;
    stopSpeaking.mockClear();

    controller.toggle();

    expect(controller.currentState.kind).toBe("off");
    expect(stopSpeaking).toHaveBeenCalled();
    expect(startListening.mock.calls.length).toBe(startListeningCallsBeforeToggleOff);
    expect(speak.mock.calls.length).toBe(speakCallsBeforeToggleOff);

    // Nothing further happens even if time passes or the (now-irrelevant) TTS
    // onDone callback the last speak() call was given were ever invoked.
    vi.advanceTimersByTime(5000);
    expect(startListening.mock.calls.length).toBe(startListeningCallsBeforeToggleOff);
  });

  it("dispose() calls stopSpeaking and clears any pending silence timer", () => {
    const { controller, stopSpeaking, onTranscriptReady, getCapturedHandlers } = createControllerWithFakes();

    controller.toggle();
    getCapturedHandlers()?.onResult("hello world", false);
    stopSpeaking.mockClear();

    controller.dispose();

    expect(stopSpeaking).toHaveBeenCalled();

    // The silence timer that was pending when dispose() ran must not fire afterward.
    vi.advanceTimersByTime(5000);
    expect(onTranscriptReady).not.toHaveBeenCalled();
  });

  it("provides currentState accessor", () => {
    const { controller } = createControllerWithFakes();

    expect(controller.currentState.kind).toBe("off");

    controller.toggle();

    expect(controller.currentState.kind).toBe("listening");
  });

  it("cancel() resets the in-progress transcript and silence duration, not just the state kind", () => {
    const { controller, getCapturedHandlers } = createControllerWithFakes();

    controller.toggle();
    getCapturedHandlers()?.onResult("hello", false);

    const before = controller.currentState;
    expect(before.kind).toBe("listening");
    if (before.kind === "listening") expect(before.transcript).toBe("hello");

    controller.cancel();

    const after = controller.currentState;
    expect(after.kind).toBe("listening");
    if (after.kind === "listening") {
      expect(after.transcript).toBe("");
      expect(after.silenceMs).toBe(0);
    }
  });

  it("silence timer resets on each new speech chunk instead of accumulating across chunks", () => {
    const { controller, onTranscriptReady, getCapturedHandlers } = createControllerWithFakes();

    controller.toggle();
    const handlers = getCapturedHandlers();

    handlers?.onResult("hello", false);
    vi.advanceTimersByTime(800);
    expect(controller.currentState.kind).toBe("listening");

    // A new chunk arrives before the first timer would have fired; this must
    // restart the 900ms countdown rather than let the original timer stand.
    handlers?.onResult("hello world", false);
    vi.advanceTimersByTime(800);
    expect(controller.currentState.kind).toBe("listening");
    expect(onTranscriptReady).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(controller.currentState.kind).toBe("awaiting-reply");
    expect(onTranscriptReady).toHaveBeenCalledExactlyOnceWith("hello world");
  });

  it("a stop word sends immediately and cancels the pending silence timer", () => {
    const { controller, onTranscriptReady, getCapturedHandlers } = createControllerWithFakes();

    controller.toggle();
    const handlers = getCapturedHandlers();

    handlers?.onResult("turn on the lights send it", false);

    expect(controller.currentState.kind).toBe("awaiting-reply");
    expect(onTranscriptReady).toHaveBeenCalledExactlyOnceWith("turn on the lights");

    // If the silence timer weren't cancelled, it would still be pending here
    // and could fire a stray second SILENCE_TICK once this much time passes.
    vi.advanceTimersByTime(2000);
    expect(onTranscriptReady).toHaveBeenCalledOnce();
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

  it("the speak() onDone callback transitions back to listening and restarts the mic, continuing the hands-free loop", () => {
    const { controller, speak, startListening, getCapturedHandlers } = createControllerWithFakes();

    controller.toggle();
    getCapturedHandlers()?.onResult("hello world", false);
    vi.advanceTimersByTime(1000);
    controller.replyReceived("hi there");
    expect(controller.currentState.kind).toBe("speaking");

    const startListeningCallsBeforeReply = startListening.mock.calls.length;
    const lastSpeakCall = speak.mock.calls.at(-1);
    expect(lastSpeakCall).toBeDefined();
    const onDone = lastSpeakCall?.[1];

    onDone?.();

    expect(controller.currentState.kind).toBe("listening");
    expect(startListening.mock.calls.length).toBe(startListeningCallsBeforeReply + 1);
  });
});
