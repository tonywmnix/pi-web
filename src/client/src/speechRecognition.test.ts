// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { isSpeechRecognitionSupported, startListening } from "./speechRecognition";

afterEach(() => {
  Reflect.deleteProperty(window, "SpeechRecognition");
});

describe("isSpeechRecognitionSupported", () => {
  it("returns false when SpeechRecognition is absent", () => {
    expect(isSpeechRecognitionSupported()).toBe(false);
  });

  it("returns true when SpeechRecognition is present", () => {
    // Stub a minimal SpeechRecognition
    class FakeSpeechRecognition {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      start(): void {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      stop(): void {}
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      abort(): void {}
    }

    Object.defineProperty(window, "SpeechRecognition", {
      value: FakeSpeechRecognition,
      configurable: true,
    });

    expect(isSpeechRecognitionSupported()).toBe(true);
  });
});

describe("startListening", () => {
  it("returns a handle with a stop() method", () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const handle = startListening({ onResult: () => {} });
    expect(typeof handle.stop).toBe("function");
  });

  it("handle.stop() does not throw when unsupported", () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const handle = startListening({ onResult: () => {} });
    expect(() => {
      handle.stop();
    }).not.toThrow();
  });

  it("does not call onResult when SpeechRecognition is unsupported", () => {
    let callCount = 0;
    startListening({
      onResult: () => {
        callCount += 1;
      },
    });
    expect(callCount).toBe(0);
  });

  it("works with all handler functions provided", () => {
    let resultCount = 0;
    let errorCount = 0;
    let endCount = 0;

    const handle = startListening({
      onResult: () => {
        resultCount += 1;
      },
      onError: () => {
        errorCount += 1;
      },
      onEnd: () => {
        endCount += 1;
      },
    });

    // When unsupported, none should be called
    expect(resultCount).toBe(0);
    expect(errorCount).toBe(0);
    expect(endCount).toBe(0);

    // Handle should still work
    expect(typeof handle.stop).toBe("function");
  });
});
