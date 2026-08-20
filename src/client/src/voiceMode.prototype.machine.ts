/**
 * PROTOTYPE — throwaway. Not wired into the app.
 *
 * Question this answers: for voice mode (mic toggle near send/stop), what state
 * model decides "the user is done talking, send it now" — and does that model
 * hold up under real edge cases: pausing mid-thought, a stop word arriving with
 * an empty transcript, toggling voice mode off while a reply is in flight,
 * barging in over TTS playback?
 *
 * This module is pure: no DOM, no SpeechRecognition/speechSynthesis calls, no I/O.
 * It's a state machine over discrete events; the browser-facing prototype (or the
 * real implementation) supplies the actual mic/TTS glue and turns their async
 * events into calls to `reduce`.
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
      return {
        kind: "listening",
        transcript: appendChunk(state.transcript, event.text),
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

function appendChunk(transcript: string, chunk: string): string {
  if (transcript === "") return chunk;
  return `${transcript} ${chunk}`;
}
