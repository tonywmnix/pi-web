/**
 * Pure state machine for voice mode. No DOM, no I/O, no browser API calls.
 * Decides state transitions driven by discrete events: speech recognition
 * results, silence timeouts, stop-word detection, assistant replies, and
 * text-to-speech lifecycle.
 *
 * This module was ported from a validated prototype
 * (voiceMode.prototype.machine.ts) with one deliberate change in reduceListening's
 * SPEECH_CHUNK case: replaces the transcript instead of appending. The real
 * SpeechRecognition API's onresult handler delivers the full current cumulative
 * transcript for the in-progress utterance (revised/recomputed by the browser
 * across events), not discrete words to append, so replacement is correct here.
 * Appending was only valid for the prototype's canned single-word simulation.
 */

export const SILENCE_SEND_THRESHOLD_MS = 900;

export type VoiceState =
  | { kind: "off" }
  | { kind: "listening"; transcript: string; silenceMs: number }
  | { kind: "awaiting-reply"; transcript: string }
  | { kind: "speaking"; reply: string };

export type VoiceEvent =
  | { kind: "TOGGLE" }
  | { kind: "SPEECH_CHUNK"; text: string }
  | { kind: "SILENCE_TICK"; ms: number }
  | { kind: "STOP_WORD_DETECTED" }
  | { kind: "REPLY_RECEIVED"; text: string }
  | { kind: "TTS_DONE" }
  | { kind: "BARGE_IN"; text: string }
  | { kind: "CANCEL" };

export const initialVoiceState: VoiceState = { kind: "off" };

export function reduce(state: VoiceState, event: VoiceEvent): VoiceState {
  // TOGGLE is legal from every state and always wins: it either turns voice mode
  // on (start fresh, listening, empty transcript) or off (regardless of what was
  // in flight — an in-flight REPLY_RECEIVED/TTS_DONE arriving after TOGGLE off is
  // simply ignored below, because `off` has no transition for them).
  if (event.kind === "TOGGLE") {
    return state.kind === "off" ? { kind: "listening", transcript: "", silenceMs: 0 } : { kind: "off" };
  }

  switch (state.kind) {
    case "off":
      // Nothing else is legal while voice mode is off; mic/TTS are both inactive.
      return state;
    case "listening":
      return reduceListening(state, event);
    case "awaiting-reply":
      return reduceAwaitingReply(state, event);
    case "speaking":
      return reduceSpeaking(state, event);
  }
}

function reduceListening(
  state: Extract<VoiceState, { kind: "listening" }>,
  event: VoiceEvent,
): VoiceState {
  switch (event.kind) {
    case "SPEECH_CHUNK":
      // Replace the transcript with the new chunk text instead of appending.
      // The browser's SpeechRecognition API hands us the full cumulative
      // transcript for the current utterance (revised across events), not a
      // discrete new word, so replacement is correct.
      return {
        kind: "listening",
        transcript: event.text,
        silenceMs: 0,
      };
    case "SILENCE_TICK": {
      if (state.transcript.trim() === "") {
        // Silence with nothing said yet: not a pause to send, just quiet mic.
        return state;
      }
      const silenceMs = state.silenceMs + event.ms;
      if (silenceMs >= SILENCE_SEND_THRESHOLD_MS) {
        return { kind: "awaiting-reply", transcript: state.transcript };
      }
      return { kind: "listening", transcript: state.transcript, silenceMs };
    }
    case "STOP_WORD_DETECTED":
      if (state.transcript.trim() === "") {
        // Stop word with nothing said: ignore, there's nothing to send.
        return state;
      }
      return { kind: "awaiting-reply", transcript: state.transcript };
    case "CANCEL":
      return { kind: "listening", transcript: "", silenceMs: 0 };
    case "REPLY_RECEIVED":
    case "TTS_DONE":
    case "BARGE_IN":
      // Don't apply while listening.
      return state;
    case "TOGGLE":
      // Handled by the caller before dispatch reaches here.
      return state;
  }
}

function reduceAwaitingReply(
  state: Extract<VoiceState, { kind: "awaiting-reply" }>,
  event: VoiceEvent,
): VoiceState {
  switch (event.kind) {
    case "REPLY_RECEIVED":
      return { kind: "speaking", reply: event.text };
    case "SPEECH_CHUNK":
    case "SILENCE_TICK":
    case "STOP_WORD_DETECTED":
    case "CANCEL":
    case "TTS_DONE":
    case "BARGE_IN":
      // Mic is muted while awaiting a reply; nothing else is legal here.
      return state;
    case "TOGGLE":
      return state;
  }
}

function reduceSpeaking(
  state: Extract<VoiceState, { kind: "speaking" }>,
  event: VoiceEvent,
): VoiceState {
  switch (event.kind) {
    case "TTS_DONE":
      return { kind: "listening", transcript: "", silenceMs: 0 };
    case "BARGE_IN":
      // User starts talking over the assistant: cancel TTS immediately and
      // start a fresh listening turn seeded with what they just said.
      return { kind: "listening", transcript: event.text, silenceMs: 0 };
    case "SPEECH_CHUNK":
    case "SILENCE_TICK":
    case "STOP_WORD_DETECTED":
    case "REPLY_RECEIVED":
    case "CANCEL":
      return state;
    case "TOGGLE":
      return state;
  }
}

export const STOP_PHRASES = ["send it", "send now", "go ahead", "that's it", "send"] as const;

/**
 * Trailing stop-word/phrase detection: if `transcript` ends with one of a
 * fixed set of trigger phrases (case-insensitive, ignoring trailing
 * whitespace/punctuation), returns the transcript with that phrase removed
 * so voice mode can send immediately instead of waiting out the silence
 * timeout. Returns matched: false with the original transcript trimmed when
 * no trigger phrase is present.
 *
 * If the remainder after stripping the stop phrase is empty, still returns
 * matched: true with strippedTranscript: "" (caller decides what to do with
 * an empty send).
 */
export function detectStopWord(transcript: string): { matched: boolean; strippedTranscript: string } {
  const trimmed = transcript.trim();

  // Strip trailing punctuation (.?!,) before comparing.
  const normalized = trimmed.replace(/[.?!,\s]+$/, "");

  for (const phrase of STOP_PHRASES) {
    // Case-insensitive match at the end.
    if (normalized.toLowerCase().endsWith(phrase.toLowerCase())) {
      // Remove the phrase and any trailing whitespace before it.
      const beforePhrase = normalized
        .slice(0, normalized.length - phrase.length)
        .trim();
      return { matched: true, strippedTranscript: beforePhrase };
    }
  }

  return { matched: false, strippedTranscript: trimmed };
}
