import { describe, it, expect } from "vitest";
import {
  reduce,
  initialVoiceState,
  detectStopWord,
  SILENCE_SEND_THRESHOLD_MS,
  STOP_PHRASES,
  type VoiceState,
} from "./voiceMode";

describe("voiceMode state machine", () => {
  describe("reduce TOGGLE", () => {
    it("TOGGLE from off goes to listening with empty transcript and 0 silence", () => {
      const next = reduce(initialVoiceState, { kind: "TOGGLE" });
      expect(next.kind).toBe("listening");
      if (next.kind === "listening") {
        expect(next.transcript).toBe("");
        expect(next.silenceMs).toBe(0);
      }
    });

    it("TOGGLE from listening goes to off", () => {
      const state: VoiceState = { kind: "listening", transcript: "hello", silenceMs: 100 };
      const next = reduce(state, { kind: "TOGGLE" });
      expect(next.kind).toBe("off");
    });

    it("TOGGLE from awaiting-reply goes to off", () => {
      const state: VoiceState = { kind: "awaiting-reply", transcript: "hello" };
      const next = reduce(state, { kind: "TOGGLE" });
      expect(next.kind).toBe("off");
    });

    it("TOGGLE from speaking goes to off", () => {
      const state: VoiceState = { kind: "speaking", reply: "hello" };
      const next = reduce(state, { kind: "TOGGLE" });
      expect(next.kind).toBe("off");
    });
  });

  describe("listening + SPEECH_CHUNK", () => {
    it("replaces transcript instead of appending", () => {
      let state: VoiceState = { kind: "listening", transcript: "", silenceMs: 0 };

      // First chunk.
      state = reduce(state, { kind: "SPEECH_CHUNK", text: "hello" });
      expect(state.kind).toBe("listening");
      if (state.kind === "listening") {
        expect(state.transcript).toBe("hello");
        expect(state.silenceMs).toBe(0);
      }

      // Second chunk replaces, does not append.
      state = reduce(state, { kind: "SPEECH_CHUNK", text: "world" });
      expect(state.kind).toBe("listening");
      if (state.kind === "listening") {
        expect(state.transcript).toBe("world");
        expect(state.silenceMs).toBe(0);
      }
    });

    it("resets silenceMs to 0", () => {
      const state: VoiceState = { kind: "listening", transcript: "test", silenceMs: 500 };
      const next = reduce(state, { kind: "SPEECH_CHUNK", text: "new" });
      if (next.kind === "listening") {
        expect(next.silenceMs).toBe(0);
      }
    });
  });

  describe("listening + SILENCE_TICK", () => {
    it("with empty transcript, no-op (stays listening, unchanged silenceMs)", () => {
      const state: VoiceState = { kind: "listening", transcript: "", silenceMs: 0 };
      const next = reduce(state, { kind: "SILENCE_TICK", ms: 50 });
      expect(next).toEqual(state);
    });

    it("with non-empty transcript below threshold, stays listening with accumulated silenceMs", () => {
      const state: VoiceState = { kind: "listening", transcript: "hello", silenceMs: 400 };
      const next = reduce(state, { kind: "SILENCE_TICK", ms: 50 });
      if (next.kind === "listening") {
        expect(next.transcript).toBe("hello");
        expect(next.silenceMs).toBe(450);
      } else {
        expect(false).toBe(true); // Should not reach here
      }
    });

    it("with ms crossing the threshold, transitions to awaiting-reply", () => {
      const state: VoiceState = {
        kind: "listening",
        transcript: "hello world",
        silenceMs: SILENCE_SEND_THRESHOLD_MS - 100,
      };
      const next = reduce(state, { kind: "SILENCE_TICK", ms: 150 });
      expect(next.kind).toBe("awaiting-reply");
      if (next.kind === "awaiting-reply") {
        expect(next.transcript).toBe("hello world");
      }
    });

    it("at exactly the threshold, transitions to awaiting-reply", () => {
      const state: VoiceState = {
        kind: "listening",
        transcript: "test",
        silenceMs: 0,
      };
      const next = reduce(state, { kind: "SILENCE_TICK", ms: SILENCE_SEND_THRESHOLD_MS });
      expect(next.kind).toBe("awaiting-reply");
      if (next.kind === "awaiting-reply") {
        expect(next.transcript).toBe("test");
      }
    });
  });

  describe("listening + STOP_WORD_DETECTED", () => {
    it("with empty transcript, no-op", () => {
      const state: VoiceState = { kind: "listening", transcript: "", silenceMs: 100 };
      const next = reduce(state, { kind: "STOP_WORD_DETECTED" });
      expect(next.kind).toBe("listening");
      if (next.kind === "listening") {
        expect(next).toEqual(state);
      }
    });

    it("with whitespace-only transcript, no-op", () => {
      const state: VoiceState = { kind: "listening", transcript: "   ", silenceMs: 100 };
      const next = reduce(state, { kind: "STOP_WORD_DETECTED" });
      expect(next.kind).toBe("listening");
      if (next.kind === "listening") {
        expect(next).toEqual(state);
      }
    });

    it("with non-empty transcript, transitions to awaiting-reply", () => {
      const state: VoiceState = { kind: "listening", transcript: "turn on the lights", silenceMs: 50 };
      const next = reduce(state, { kind: "STOP_WORD_DETECTED" });
      expect(next.kind).toBe("awaiting-reply");
      if (next.kind === "awaiting-reply") {
        expect(next.transcript).toBe("turn on the lights");
      }
    });
  });

  describe("listening + CANCEL", () => {
    it("resets transcript and silenceMs", () => {
      const state: VoiceState = { kind: "listening", transcript: "something", silenceMs: 200 };
      const next = reduce(state, { kind: "CANCEL" });
      expect(next.kind).toBe("listening");
      if (next.kind === "listening") {
        expect(next.transcript).toBe("");
        expect(next.silenceMs).toBe(0);
      }
    });
  });

  describe("listening ignores inapplicable events", () => {
    const state: VoiceState = { kind: "listening", transcript: "test", silenceMs: 100 };

    it("REPLY_RECEIVED: state unchanged", () => {
      const next = reduce(state, { kind: "REPLY_RECEIVED", text: "hello" });
      expect(next.kind).toBe("listening");
      if (next.kind === "listening") {
        expect(next).toEqual(state);
      }
    });

    it("TTS_DONE: state unchanged", () => {
      const next = reduce(state, { kind: "TTS_DONE" });
      expect(next.kind).toBe("listening");
      if (next.kind === "listening") {
        expect(next).toEqual(state);
      }
    });

    it("BARGE_IN: state unchanged", () => {
      const next = reduce(state, { kind: "BARGE_IN", text: "hello" });
      expect(next.kind).toBe("listening");
      if (next.kind === "listening") {
        expect(next).toEqual(state);
      }
    });
  });

  describe("awaiting-reply + REPLY_RECEIVED", () => {
    it("transitions to speaking with the reply text", () => {
      const state: VoiceState = { kind: "awaiting-reply", transcript: "hello" };
      const next = reduce(state, { kind: "REPLY_RECEIVED", text: "hi there" });
      expect(next.kind).toBe("speaking");
      if (next.kind === "speaking") {
        expect(next.reply).toBe("hi there");
      }
    });
  });

  describe("awaiting-reply ignores inapplicable events", () => {
    const state: VoiceState = { kind: "awaiting-reply", transcript: "test" };

    it("SPEECH_CHUNK: state unchanged", () => {
      const next = reduce(state, { kind: "SPEECH_CHUNK", text: "hello" });
      expect(next.kind).toBe("awaiting-reply");
      expect(next).toEqual(state);
    });

    it("CANCEL: state unchanged", () => {
      const next = reduce(state, { kind: "CANCEL" });
      expect(next.kind).toBe("awaiting-reply");
      expect(next).toEqual(state);
    });
  });

  describe("speaking + TTS_DONE", () => {
    it("transitions to listening with empty transcript", () => {
      const state: VoiceState = { kind: "speaking", reply: "hello there" };
      const next = reduce(state, { kind: "TTS_DONE" });
      expect(next.kind).toBe("listening");
      if (next.kind === "listening") {
        expect(next.transcript).toBe("");
        expect(next.silenceMs).toBe(0);
      }
    });
  });

  describe("speaking + BARGE_IN", () => {
    it("transitions to listening seeded with the barge-in text", () => {
      const state: VoiceState = { kind: "speaking", reply: "hello there" };
      const next = reduce(state, { kind: "BARGE_IN", text: "turn on lights" });
      expect(next.kind).toBe("listening");
      if (next.kind === "listening") {
        expect(next.transcript).toBe("turn on lights");
        expect(next.silenceMs).toBe(0);
      }
    });
  });

  describe("speaking ignores inapplicable events", () => {
    const state: VoiceState = { kind: "speaking", reply: "test" };

    it("SPEECH_CHUNK: state unchanged", () => {
      const next = reduce(state, { kind: "SPEECH_CHUNK", text: "hello" });
      expect(next.kind).toBe("speaking");
      expect(next).toEqual(state);
    });

    it("SILENCE_TICK: state unchanged", () => {
      const next = reduce(state, { kind: "SILENCE_TICK", ms: 50 });
      expect(next.kind).toBe("speaking");
      expect(next).toEqual(state);
    });
  });

  describe("detectStopWord", () => {
    it("matches each phrase in STOP_PHRASES case-insensitively at the end", () => {
      const testCases: [string, string][] = [
        ["turn on the lights send it", "turn on the lights"],
        ["turn on the lights SEND IT", "turn on the lights"],
        ["turn on the lights SEND NOW", "turn on the lights"],
        ["turn on the lights go ahead", "turn on the lights"],
        ["turn on the lights that's it", "turn on the lights"],
        ["turn on the lights send", "turn on the lights"],
      ];

      for (const testCase of testCases) {
        const input = testCase[0];
        const expected = testCase[1];
        const result = detectStopWord(input);
        expect(result.matched).toBe(true);
        expect(result.strippedTranscript).toBe(expected);
      }
    });

    it("handles trailing punctuation", () => {
      const result = detectStopWord("turn on the lights send it.");
      expect(result.matched).toBe(true);
      expect(result.strippedTranscript).toBe("turn on the lights");
    });

    it("handles multiple trailing punctuation marks", () => {
      const result = detectStopWord("turn on the lights send it.?!");
      expect(result.matched).toBe(true);
      expect(result.strippedTranscript).toBe("turn on the lights");
    });

    it("does not match phrase in the middle of text", () => {
      const result = detectStopWord("send it all the way");
      expect(result.matched).toBe(false);
      expect(result.strippedTranscript).toBe("send it all the way");
    });

    it("returns matched false with trimmed original text when nothing matches", () => {
      const result = detectStopWord("hello world");
      expect(result.matched).toBe(false);
      expect(result.strippedTranscript).toBe("hello world");
    });

    it("trims leading/trailing whitespace from original when nothing matches", () => {
      const result = detectStopWord("  hello world  ");
      expect(result.matched).toBe(false);
      expect(result.strippedTranscript).toBe("hello world");
    });

    it("returns empty strippedTranscript when remainder after stripping is empty", () => {
      const result = detectStopWord("send it");
      expect(result.matched).toBe(true);
      expect(result.strippedTranscript).toBe("");
    });

    it("returns empty strippedTranscript for phrase-only input with trailing punctuation", () => {
      const result = detectStopWord("send it.");
      expect(result.matched).toBe(true);
      expect(result.strippedTranscript).toBe("");
    });

    it("all configured stop phrases are covered", () => {
      for (const phrase of STOP_PHRASES) {
        const result = detectStopWord(`hello world ${phrase}`);
        expect(result.matched).toBe(true);
      }
    });
  });
});
