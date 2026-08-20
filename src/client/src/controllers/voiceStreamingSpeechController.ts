import { extractSpeakableChunks } from "../streamingSpeech";

export interface VoiceStreamingSpeechDependencies {
  /** True iff the active TTS provider (if any) currently wants streaming. Re-checked on every sync(). */
  isStreamingPreferred: () => boolean;
  /** True iff voice mode just sent this turn's message via the mic and is waiting for the reply to start. */
  isAwaitingVoiceReply: () => boolean;
  /** True iff voice mode is currently mid-way through an active streaming reply (i.e. beginVoiceStream() already ran for the current turn and hasn't finished). */
  isVoiceStreamActive: () => boolean;
  beginVoiceStream: () => void;
  streamVoiceChunk: (text: string) => void;
  finishVoiceStream: () => void;
}

/**
 * Watches the selected session's in-progress (not yet finalized) assistant
 * message text across renders and, when voice mode is eligible and the
 * active TTS provider wants it, feeds growing text into the streaming
 * chunker and pushes ready chunks into voice mode's streaming speech
 * methods — so replies start being spoken before the whole turn finishes
 * generating, instead of only once it's done.
 *
 * `sync()` is meant to be called on every render (see PiWebApp's
 * willUpdate()) with the live status/text for the *currently selected*
 * session; `finishTurn()` is meant to be called once, from the existing
 * "a turn just finished with a readable assistant message" signal
 * (assistantMessageObservers), so the reply doesn't get spoken a second
 * time via the old full-text path when it was already streamed.
 */
export class VoiceStreamingSpeechController {
  private consumedLength = 0;
  private remainder = "";
  private streamingThisTurn = false;

  constructor(private readonly deps: VoiceStreamingSpeechDependencies) {}

  sync(isSessionStreaming: boolean, inProgressAssistantText: string | undefined): void {
    if (this.streamingThisTurn && !this.deps.isVoiceStreamActive()) {
      // Voice mode fell out of its streaming-speech substate for some other
      // reason (toggled off, cancelled) - don't keep trying to feed it, and
      // don't carry stale buffered text into whatever the next turn is.
      this.reset();
      return; // Don't start a new stream in the same sync call
    }
    if (!isSessionStreaming || inProgressAssistantText === undefined) return;
    if (!this.streamingThisTurn) {
      if (!this.deps.isAwaitingVoiceReply() || !this.deps.isStreamingPreferred()) return;
      this.streamingThisTurn = true;
      this.consumedLength = 0;
      this.remainder = "";
      this.deps.beginVoiceStream();
    }
    const newText = inProgressAssistantText.slice(this.consumedLength);
    if (newText === "") return;
    this.consumedLength = inProgressAssistantText.length;
    this.remainder += newText;
    const { chunks, remainder } = extractSpeakableChunks(this.remainder);
    this.remainder = remainder;
    for (const chunk of chunks) this.deps.streamVoiceChunk(chunk);
  }

  /**
   * Call once a turn finishes (the assistantMessageObservers "finished with
   * a readable assistant message" signal). Returns true if this turn's
   * reply was already spoken via streaming — the caller should NOT also
   * speak the full text through the old non-streaming path in that case.
   */
  finishTurn(): boolean {
    if (!this.streamingThisTurn) return false;
    if (this.remainder.trim() !== "") this.deps.streamVoiceChunk(this.remainder);
    this.deps.finishVoiceStream();
    this.reset();
    return true;
  }

  private reset(): void {
    this.streamingThisTurn = false;
    this.consumedLength = 0;
    this.remainder = "";
  }
}
