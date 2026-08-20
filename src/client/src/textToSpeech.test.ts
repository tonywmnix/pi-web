// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { isTextToSpeechSupported, speak, stopSpeaking } from "./textToSpeech";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "speechSynthesis");
  Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
});

/** Minimal fake standing in for `SpeechSynthesisUtterance` + `window.speechSynthesis`,
 * since happy-dom does not implement the Web Speech API. */
function stubSpeechSynthesis() {
  const cancel = vi.fn();
  const spoken: string[] = [];
  const utteranceListeners: Record<string, (() => void) | undefined> = {};

  class FakeUtterance {
    text: string;
    constructor(text: string) {
      this.text = text;
    }
    addEventListener(type: string, listener: () => void) {
      utteranceListeners[type] = listener;
    }
  }
  Object.defineProperty(window, "SpeechSynthesisUtterance", { value: FakeUtterance, configurable: true });
  Object.defineProperty(window, "speechSynthesis", {
    value: {
      cancel,
      speak: (utterance: FakeUtterance) => {
        spoken.push(utterance.text);
      },
    },
    configurable: true,
  });

  return {
    cancel,
    spoken,
    fireEnd: () => utteranceListeners["end"]?.(),
    fireError: () => utteranceListeners["error"]?.(),
  };
}

describe("textToSpeech", () => {
  it("reports unsupported when speechSynthesis is absent", () => {
    expect(isTextToSpeechSupported()).toBe(false);
  });

  it("reports supported once speechSynthesis is present", () => {
    stubSpeechSynthesis();
    expect(isTextToSpeechSupported()).toBe(true);
  });

  it("speaks the given text and calls onDone when playback ends", () => {
    const fake = stubSpeechSynthesis();
    const onDone = vi.fn();

    speak("hello there", onDone);

    expect(fake.spoken).toEqual(["hello there"]);
    expect(onDone).not.toHaveBeenCalled();

    fake.fireEnd();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("calls onDone on utterance error", () => {
    const fake = stubSpeechSynthesis();
    const onDone = vi.fn();

    speak("hello", onDone);
    fake.fireError();

    expect(onDone).toHaveBeenCalledOnce();
  });

  it("cancels any prior utterance before speaking a new one", () => {
    const fake = stubSpeechSynthesis();
    const noop = () => undefined;

    speak("first", noop);
    speak("second", noop);

    expect(fake.cancel).toHaveBeenCalledTimes(2);
    expect(fake.spoken).toEqual(["first", "second"]);
  });

  it("calls onDone immediately without speaking when text is blank", () => {
    stubSpeechSynthesis();
    const onDone = vi.fn();

    speak("   ", onDone);

    expect(onDone).toHaveBeenCalledOnce();
  });

  it("calls onDone immediately without speaking when unsupported", () => {
    const onDone = vi.fn();

    speak("hello", onDone);

    expect(onDone).toHaveBeenCalledOnce();
  });

  it("stopSpeaking cancels the active utterance", () => {
    const fake = stubSpeechSynthesis();

    stopSpeaking();

    expect(fake.cancel).toHaveBeenCalledOnce();
  });

  it("stopSpeaking is a no-op when unsupported", () => {
    expect(() => { stopSpeaking(); }).not.toThrow();
  });
});
