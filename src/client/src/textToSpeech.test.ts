// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { isTextToSpeechSupported, setActiveTtsProvider, speak, stopSpeaking } from "./textToSpeech";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, "speechSynthesis");
  Reflect.deleteProperty(window, "SpeechSynthesisUtterance");
  // activeProvider is module-level state; clear it so it doesn't leak into
  // the next test (whether or not that test itself sets one).
  setActiveTtsProvider(undefined);
});

function fakeProvider() {
  return { speak: vi.fn(), stopSpeaking: vi.fn() };
}

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

describe("textToSpeech active provider delegation", () => {
  it("reports supported once a provider is set, even with no native speechSynthesis", () => {
    expect(isTextToSpeechSupported()).toBe(false);
    setActiveTtsProvider(fakeProvider());
    expect(isTextToSpeechSupported()).toBe(true);
  });

  it("speak() delegates to the active provider instead of native speechSynthesis", () => {
    const native = stubSpeechSynthesis();
    const provider = fakeProvider();
    setActiveTtsProvider(provider);
    const onDone = vi.fn();

    speak("hello", onDone);

    expect(provider.speak).toHaveBeenCalledWith("hello", onDone);
    expect(native.spoken).toEqual([]);
  });

  it("stopSpeaking() delegates to the active provider instead of native speechSynthesis", () => {
    const native = stubSpeechSynthesis();
    const provider = fakeProvider();
    setActiveTtsProvider(provider);
    native.cancel.mockClear();

    stopSpeaking();

    expect(provider.stopSpeaking).toHaveBeenCalledOnce();
    expect(native.cancel).not.toHaveBeenCalled();
  });

  it("still short-circuits blank text without calling the provider", () => {
    const provider = fakeProvider();
    setActiveTtsProvider(provider);
    const onDone = vi.fn();

    speak("   ", onDone);

    expect(provider.speak).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("stops the outgoing provider when switching to a different provider", () => {
    const first = fakeProvider();
    const second = fakeProvider();
    setActiveTtsProvider(first);

    setActiveTtsProvider(second);

    expect(first.stopSpeaking).toHaveBeenCalledOnce();
    expect(second.stopSpeaking).not.toHaveBeenCalled();
  });

  it("stops the outgoing provider and falls back to native speechSynthesis when cleared", () => {
    const native = stubSpeechSynthesis();
    const provider = fakeProvider();
    setActiveTtsProvider(provider);

    setActiveTtsProvider(undefined);
    const onDone = vi.fn();
    speak("hello again", onDone);

    expect(provider.stopSpeaking).toHaveBeenCalledOnce();
    expect(native.spoken).toEqual(["hello again"]);
  });

  it("setActiveTtsProvider is a no-op (no extra stop) when set to the same provider instance again", () => {
    const provider = fakeProvider();
    setActiveTtsProvider(provider);

    setActiveTtsProvider(provider);

    expect(provider.stopSpeaking).not.toHaveBeenCalled();
  });
});
