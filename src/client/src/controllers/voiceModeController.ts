import {
  reduce,
  initialVoiceState,
  detectStopWord,
  SILENCE_SEND_THRESHOLD_MS,
  type VoiceState,
  type VoiceEvent,
} from "../voiceMode";
import type { SpeechRecognitionHandle } from "../speechRecognition";

export interface VoiceModeControllerDependencies {
  /** Called once per finished utterance (silence timeout or stop word), with
   * the final transcript text, so the host can send it as the next chat
   * message. Never called with blank/whitespace-only text (the reducer
   * already guards that). */
  onTranscriptReady: (transcript: string) => void;
  /** Called after every state transition so the host can re-render. */
  onStateChange: (state: VoiceState) => void;
  /** Injected browser collaborators — production wiring passes the real
   * `startListening`/`speak`/`stopSpeaking` from speechRecognition.ts /
   * textToSpeech.ts; tests inject fakes. */
  startListening: (handlers: {
    onResult: (transcript: string, isFinal: boolean) => void;
    onError?: (error: string) => void;
    onEnd?: () => void;
  }) => SpeechRecognitionHandle;
  speak: (text: string, onDone: () => void) => void;
  stopSpeaking: () => void;
  /** Silence timeout before an in-progress utterance auto-sends. Defaults to
   * SILENCE_SEND_THRESHOLD_MS; overridable for tests. */
  silenceTimeoutMs?: number;
}

export class VoiceModeController {
  private state: VoiceState = initialVoiceState;
  private recognitionHandle: SpeechRecognitionHandle | undefined;
  private silenceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly deps: VoiceModeControllerDependencies;
  private streaming = false;
  private streamQueue: string[] = [];
  private streamChunkInFlight = false;
  private streamEnded = false;

  constructor(deps: VoiceModeControllerDependencies) {
    this.deps = deps;
  }

  get currentState(): VoiceState {
    return this.state;
  }

  /** True while a streaming reply is actively being spoken (i.e. `beginStreamingReply()` was called for the current turn and `endStream()`'s queue hasn't fully drained yet). */
  get isStreaming(): boolean {
    return this.streaming;
  }

  toggle(): void {
    this.dispatch({ kind: "TOGGLE" });
  }

  replyReceived(text: string): void {
    this.dispatch({ kind: "REPLY_RECEIVED", text });
  }

  cancel(): void {
    this.dispatch({ kind: "CANCEL" });
  }

  /**
   * Starts a streaming reply: transitions `awaiting-reply` -> `speaking`
   * exactly like `replyReceived()` does, but does NOT itself speak anything
   * — chunks arrive one at a time via `streamChunk()` instead. A no-op if
   * not currently `awaiting-reply` (mirrors `replyReceived()`'s implicit
   * guard: the underlying reducer just ignores REPLY_RECEIVED outside that
   * state).
   */
  beginStreamingReply(): void {
    this.streaming = true;
    this.streamQueue = [];
    this.streamChunkInFlight = false;
    this.streamEnded = false;
    this.dispatch({ kind: "REPLY_RECEIVED", text: "" });
  }

  /**
   * Queues one chunk of text to be spoken next, once any prior chunk finishes.
   * No-op if not currently in an active streaming reply (`isStreaming` false)
   * or if the text is blank.
   */
  streamChunk(text: string): void {
    if (!this.streaming || text.trim() === "") return;
    this.streamQueue.push(text);
    this.pumpStreamQueue();
  }

  /**
   * Signals no more chunks are coming for this turn. Once every already-
   * queued chunk has finished playing, dispatches TTS_DONE (returning voice
   * mode to listening) exactly as the non-streaming path does when a single
   * full-reply utterance finishes.
   */
  endStream(): void {
    if (!this.streaming) return;
    this.streamEnded = true;
    this.maybeFinishStream();
  }

  private pumpStreamQueue(): void {
    if (this.streamChunkInFlight) return;
    const next = this.streamQueue.shift();
    if (next === undefined) {
      this.maybeFinishStream();
      return;
    }
    this.streamChunkInFlight = true;
    this.deps.speak(next, () => {
      this.streamChunkInFlight = false;
      this.pumpStreamQueue();
    });
  }

  private maybeFinishStream(): void {
    if (!this.streamEnded || this.streamChunkInFlight || this.streamQueue.length > 0) return;
    this.streaming = false;
    this.dispatch({ kind: "TTS_DONE" });
  }

  dispose(): void {
    this.clearSilenceTimer();
    this.stopMic();
    this.deps.stopSpeaking();
  }

  private dispatch(event: VoiceEvent): void {
    const prevKind = this.state.kind;
    this.state = reduce(this.state, event);
    this.syncSideEffects(prevKind);
    this.deps.onStateChange(this.state);
  }

  private syncSideEffects(prevKind: string): void {
    // Stop mic if no longer listening.
    if (this.state.kind !== "listening") {
      this.stopMic();
    }

    // Stop TTS if no longer speaking.
    if (this.state.kind !== "speaking") {
      this.deps.stopSpeaking();
      this.streaming = false;
      this.streamQueue = [];
      this.streamChunkInFlight = false;
      this.streamEnded = false;
    }

    // Start mic if just entered listening.
    if (this.state.kind === "listening" && prevKind !== "listening") {
      this.startMic();
    }

    // Notify when transitioning to awaiting-reply.
    if (this.state.kind === "awaiting-reply" && prevKind === "listening") {
      this.deps.onTranscriptReady(this.state.transcript);
    }

    // Start TTS when transitioning to speaking (skip if streaming).
    if (this.state.kind === "speaking" && prevKind === "awaiting-reply" && !this.streaming) {
      const reply = this.state.reply;
      this.deps.speak(reply, () => {
        this.dispatch({ kind: "TTS_DONE" });
      });
    }
  }

  private startMic(): void {
    this.recognitionHandle = this.deps.startListening({
      onResult: (transcript, _isFinal) => {
        this.handleRecognitionResult(transcript, _isFinal);
      },
      onEnd: () => {
        this.recognitionHandle = undefined;
      },
      onError: () => {
        this.stopMic();
      },
    });
  }

  private stopMic(): void {
    this.clearSilenceTimer();
    if (this.recognitionHandle !== undefined) {
      this.recognitionHandle.stop();
      this.recognitionHandle = undefined;
    }
  }

  private handleRecognitionResult(transcript: string, isFinal: boolean): void {
    void isFinal; // Unused: silence debounce timer is the source of truth for "done talking",
    // not the browser's interim/final flag, since continuous mode's "final" events don't align
    // with natural pause boundaries across browsers.

    const stopWord = detectStopWord(transcript);
    this.dispatch({
      kind: "SPEECH_CHUNK",
      text: stopWord.matched ? stopWord.strippedTranscript : transcript,
    });

    if (stopWord.matched) {
      this.clearSilenceTimer();
      this.dispatch({ kind: "STOP_WORD_DETECTED" });
    } else {
      this.resetSilenceTimer();
    }
  }

  private resetSilenceTimer(): void {
    this.clearSilenceTimer();
    const timeoutMs = this.deps.silenceTimeoutMs ?? SILENCE_SEND_THRESHOLD_MS;
    this.silenceTimer = setTimeout(() => {
      this.dispatch({ kind: "SILENCE_TICK", ms: timeoutMs });
    }, timeoutMs);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer !== undefined) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = undefined;
    }
  }
}
