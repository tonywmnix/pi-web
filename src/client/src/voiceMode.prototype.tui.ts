/**
 * PROTOTYPE — throwaway terminal shell. Not wired into the app.
 *
 * Drives `voiceMode.prototype.machine.ts` by hand so we can push the state
 * model through cases that are hard to reason about on paper (mid-thought
 * pauses, stop word on empty transcript, toggling off mid-reply, barge-in
 * over TTS). See that file for the model itself; this file is just a
 * keystroke -> event -> render loop.
 *
 * Run: npm run prototype:voice-mode
 */

import readline from "node:readline";
import {
  reduce,
  initialVoiceState,
  SILENCE_SEND_THRESHOLD_MS,
  type VoiceState,
  type VoiceEvent,
} from "./voiceMode.prototype.machine.js";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CLEAR = "\x1b[2J\x1b[H";

// Canned "interim speech" words, so [s] simulates chunks arriving over time
// instead of requiring real typing/mic input.
const SPEECH_WORDS = ["what's", "the", "weather", "like", "tomorrow", "in", "portland"];
const CANNED_REPLY = "Tomorrow in Portland: mostly cloudy, high of 58.";
const CANNED_BARGE_IN = "wait actually";

let state: VoiceState = initialVoiceState;
let lastEvent = "(none)";
let speechWordIndex = 0;

function dispatch(event: VoiceEvent) {
  lastEvent = event.kind;
  state = reduce(state, event);
  render();
}

function render() {
  process.stdout.write(CLEAR);
  console.log(`${BOLD}Voice mode prototype${RESET} ${DIM}(logic-only, no real mic/TTS)${RESET}\n`);

  console.log(`${BOLD}state${RESET}: ${describeState(state)}`);
  if (state.kind === "listening") {
    const bar = silenceBar(state.silenceMs);
    console.log(`${BOLD}transcript${RESET}: ${state.transcript || DIM + "(empty)" + RESET}`);
    console.log(
      `${BOLD}silence${RESET}: ${String(state.silenceMs)}ms / ${String(SILENCE_SEND_THRESHOLD_MS)}ms  ${bar}`,
    );
  } else if (state.kind === "awaiting-reply") {
    console.log(`${BOLD}sent transcript${RESET}: ${state.transcript}`);
  } else if (state.kind === "speaking") {
    console.log(`${BOLD}reply (TTS playing)${RESET}: ${state.reply}`);
  }
  console.log(`${DIM}last event: ${lastEvent}${RESET}\n`);

  console.log(legend());
}

function describeState(s: VoiceState): string {
  switch (s.kind) {
    case "off":
      return "off";
    case "listening":
      return "listening";
    case "awaiting-reply":
      return "awaiting-reply (mic muted, waiting on assistant)";
    case "speaking":
      return "speaking (TTS playing, mic muted)";
  }
}

function silenceBar(ms: number): string {
  const width = 20;
  const filled = Math.min(width, Math.round((ms / SILENCE_SEND_THRESHOLD_MS) * width));
  return "[" + "#".repeat(filled) + "-".repeat(width - filled) + "]";
}

function legend(): string {
  const items: [string, string, boolean][] = [
    ["t", "toggle voice mode on/off", true],
    ["s", "speech chunk arrives (next canned word)", state.kind === "listening"],
    ["p", "silence tick (+300ms)", state.kind === "listening"],
    ["w", "stop word detected -> force send", state.kind === "listening"],
    ["c", "cancel current utterance", state.kind === "listening"],
    ["r", "assistant reply arrives", state.kind === "awaiting-reply"],
    ["e", "TTS finishes", state.kind === "speaking"],
    ["b", "barge in (user talks over TTS)", state.kind === "speaking"],
    ["q", "quit", true],
  ];
  return items
    .map(([key, desc, legal]) => {
      const style = legal ? "" : DIM;
      return `${style}${BOLD}[${key}]${RESET}${style} ${desc}${RESET}`;
    })
    .join("\n");
}

readline.emitKeypressEvents(process.stdin);
if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.resume();

render();

process.stdin.on("keypress", (_str: string, key: readline.Key) => {
  if (key.ctrl === true && key.name === "c") process.exit(0);
  if (key.name === undefined) return;
  switch (key.name) {
    case "t":
      dispatch({ kind: "TOGGLE" });
      break;
    case "s": {
      const word = SPEECH_WORDS[speechWordIndex % SPEECH_WORDS.length];
      speechWordIndex += 1;
      dispatch({ kind: "SPEECH_CHUNK", text: word ?? "" });
      break;
    }
    case "p":
      dispatch({ kind: "SILENCE_TICK", ms: 300 });
      break;
    case "w":
      dispatch({ kind: "STOP_WORD_DETECTED" });
      break;
    case "c":
      dispatch({ kind: "CANCEL" });
      break;
    case "r":
      dispatch({ kind: "REPLY_RECEIVED", text: CANNED_REPLY });
      break;
    case "e":
      dispatch({ kind: "TTS_DONE" });
      break;
    case "b":
      dispatch({ kind: "BARGE_IN", text: CANNED_BARGE_IN });
      break;
    case "q":
      process.exit(0);
  }
});
