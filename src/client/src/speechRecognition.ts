/**
 * Thin wrapper around the browser SpeechRecognition API ("Web Speech API",
 * input side) for voice-mode listening. Kept separate from the voice-mode
 * controller so browser globals are touched in exactly one place.
 *
 * Not declared in this project's TS DOM lib, so the constructor and its
 * event/result shapes are declared locally and merged onto `Window` via
 * `declare global` (this repo's lint config forbids `as` type assertions,
 * so declaration merging — not casting — is how we access nonstandard
 * browser globals).
 */

interface MinimalSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): { readonly transcript: string };
  [index: number]: { readonly transcript: string };
}

interface MinimalSpeechRecognitionResultList {
  readonly length: number;
  item(index: number): MinimalSpeechRecognitionResult;
  [index: number]: MinimalSpeechRecognitionResult;
}

interface MinimalSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: MinimalSpeechRecognitionResultList;
}

interface MinimalSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: MinimalSpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

type MinimalSpeechRecognitionConstructor = new () => MinimalSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: MinimalSpeechRecognitionConstructor;
    webkitSpeechRecognition?: MinimalSpeechRecognitionConstructor;
  }
}

function speechRecognitionConstructor(): MinimalSpeechRecognitionConstructor | undefined {
  if (typeof window === "undefined") return undefined;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition;
}

export function isSpeechRecognitionSupported(): boolean {
  return speechRecognitionConstructor() !== undefined;
}

export interface SpeechRecognitionHandlers {
  /** Called on every result event with the full cumulative transcript text
   * for the current utterance (not just the newest word) and whether the
   * browser considers it final. */
  onResult: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

export interface SpeechRecognitionHandle {
  stop: () => void;
}

/** Starts listening. Returns a handle whose `stop()` ends recognition.
 * Returns a no-op handle immediately (without starting) if unsupported. */
export function startListening(handlers: SpeechRecognitionHandlers): SpeechRecognitionHandle {
  const Ctor = speechRecognitionConstructor();
  if (Ctor === undefined) return { stop: () => {
    // no-op: SpeechRecognition not supported
  } };

  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = typeof navigator !== "undefined" ? navigator.language : "en-US";

  recognition.onresult = (event: MinimalSpeechRecognitionEvent) => {
    // Build the full cumulative transcript across all results from index 0
    // (not just event.resultIndex onward) so onResult always receives the
    // complete current utterance text, and track whether the LAST result is
    // final.
    let transcript = "";
    let isFinal = false;
    for (let i = 0; i < event.results.length; i += 1) {
      const result = event.results.item(i);
      transcript += (transcript === "" ? "" : " ") + result.item(0).transcript;
      isFinal = result.isFinal;
    }
    handlers.onResult(transcript.trim(), isFinal);
  };
  recognition.onerror = () => {
    handlers.onError?.("speech-recognition-error");
  };
  recognition.onend = () => {
    handlers.onEnd?.();
  };

  recognition.start();

  return {
    stop: () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.stop();
    },
  };
}
