/**
 * Turns a growing buffer of raw assistant-reply text (markdown source,
 * exactly what `messagePlainText()` returns — see chatMessages.ts) into
 * complete, speakable chunks plus whatever's left over, for streaming TTS.
 * Pure: no I/O, no DOM.
 */

export interface ChunkResult {
  /** Complete, speakable chunks extracted from the front of the buffer, in order. */
  chunks: string[];
  /** Whatever's left after the last extracted chunk; feed it back in as the
   * start of the next call's input once more text has arrived. */
  remainder: string;
}

/**
 * Extracts every currently-complete chunk from `bufferedText`. A "chunk" is
 * either:
 *  - text up to and including a sentence-ending `.`, `!`, or `?` followed by
 *    whitespace (or end of string) — trimmed before being added to `chunks`;
 *  - or text up to a blank line (`\n\n`), for chunk boundaries that aren't
 *    sentence punctuation.
 *
 * Fenced code blocks (content between a pair of ``` markers) are
 * recognized and their content is dropped entirely — never included in any
 * returned chunk, never spoken. An *unclosed* trailing fence (an odd number
 * of ``` markers seen so far) means "don't know yet whether this is code";
 * everything from that unclosed fence marker onward is held back in
 * `remainder`, not turned into chunks, until either the fence closes (its
 * content is then dropped) or the caller decides to flush regardless (e.g.
 * turn ended) — flushing an unclosed-fence remainder is the caller's call,
 * this function just never manufactures a chunk out of unresolved fenced
 * content.
 *
 * Callers should keep exactly one running buffer: call this with (previous
 * remainder + newly arrived text), use the returned chunks, and keep
 * `remainder` as the new buffer for next time.
 */
export function extractSpeakableChunks(bufferedText: string): ChunkResult {
  const FENCE = "```";
  // Single left-to-right pass: strip every *closed* fence pair's content
  // (and its markers) out of the speakable text entirely, in order. If a
  // trailing fence marker has no matching close yet, everything from that
  // marker onward is held back verbatim as part of the remainder instead of
  // being run through sentence/paragraph splitting — processing text
  // preceding an unclosed fence is not enough on its own; any *earlier*,
  // already-closed fence pairs must still be stripped from that leading
  // text too, which is what iterating the whole buffer in one pass (rather
  // than only handling the last fence marker) gets right.
  let cursor = 0;
  let speakable = "";
  let unclosedFenceRemainder = "";
  while (cursor < bufferedText.length) {
    const openIndex = bufferedText.indexOf(FENCE, cursor);
    if (openIndex === -1) {
      speakable += bufferedText.slice(cursor);
      break;
    }
    speakable += bufferedText.slice(cursor, openIndex);
    const closeIndex = bufferedText.indexOf(FENCE, openIndex + FENCE.length);
    if (closeIndex === -1) {
      unclosedFenceRemainder = bufferedText.slice(openIndex);
      break;
    }
    cursor = closeIndex + FENCE.length;
  }

  const result = extractChunksFromText(speakable);
  return {
    chunks: result.chunks,
    remainder: result.remainder + unclosedFenceRemainder,
  };
}

function extractChunksFromText(text: string): ChunkResult {
  const chunks: string[] = [];
  let pos = 0;

  // Now extract chunks from text based on sentence/paragraph boundaries
  const sentencePattern = /[.!?](?=\s|$)/;
  while (pos < text.length) {
    // Find the next sentence ending (.!? followed by whitespace or end of string)
    const sentenceMatch = sentencePattern.exec(text.slice(pos));
    const sentenceIndex = sentenceMatch !== null ? pos + sentenceMatch.index + 1 : -1;

    // Find the next paragraph break
    const paragraphIndex = text.indexOf("\n\n", pos);

    // Determine which boundary comes first
    let boundaryEnd = -1;
    if (sentenceIndex !== -1 && (paragraphIndex === -1 || sentenceIndex < paragraphIndex)) {
      // Sentence boundary comes first
      boundaryEnd = sentenceIndex;
      // Skip any trailing whitespace after the sentence punctuation
      while (boundaryEnd < text.length && /\s/.test(text[boundaryEnd] ?? "")) {
        boundaryEnd += 1;
      }
    } else if (paragraphIndex !== -1) {
      // Paragraph boundary comes first (or only)
      boundaryEnd = paragraphIndex + 2; // Skip the \n\n
    }

    if (boundaryEnd === -1) {
      // No boundary found; everything from pos onward is remainder
      break;
    }

    const chunk = text.slice(pos, boundaryEnd).trim();
    if (chunk !== "") chunks.push(chunk);
    pos = boundaryEnd;
  }

  const remainder = text.slice(pos);
  return { chunks, remainder };
}
