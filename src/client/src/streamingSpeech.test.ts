import { describe, expect, it } from "vitest";
import { extractSpeakableChunks } from "./streamingSpeech";

describe("extractSpeakableChunks", () => {
  it("returns no chunks and everything as remainder when there's no sentence boundary", () => {
    const result = extractSpeakableChunks("Hello there");
    expect(result.chunks).toEqual([]);
    expect(result.remainder).toBe("Hello there");
  });

  it("extracts one complete sentence and leaves partial text as remainder", () => {
    const result = extractSpeakableChunks("Hello there. And more");
    expect(result.chunks).toEqual(["Hello there."]);
    expect(result.remainder).toBe("And more");
  });

  it("extracts multiple complete sentences in one call", () => {
    const result = extractSpeakableChunks("First sentence. Second one! Third?");
    expect(result.chunks).toEqual(["First sentence.", "Second one!", "Third?"]);
    expect(result.remainder).toBe("");
  });

  it("treats a paragraph break as a chunk boundary even without terminal punctuation", () => {
    const result = extractSpeakableChunks("First paragraph\n\nSecond paragraph");
    expect(result.chunks).toEqual(["First paragraph"]);
    expect(result.remainder).toBe("Second paragraph");
  });

  it("drops fully closed fenced code blocks from chunks", () => {
    const result = extractSpeakableChunks("Before code. ```js\nconst x = 1;\n``` After code.");
    expect(result.chunks).toEqual(["Before code.", "After code."]);
    expect(result.remainder).toBe("");
  });

  it("holds back an unclosed trailing fence as remainder", () => {
    const result = extractSpeakableChunks("Some text. ```js\nconst x = 1;");
    expect(result.chunks).toEqual(["Some text."]);
    expect(result.remainder).toBe("```js\nconst x = 1;");
  });

  it("does not create chunks from text inside an unclosed fence even if it contains sentence punctuation", () => {
    const result = extractSpeakableChunks("Intro. ```js\nfunction test() { return true; }\n// More code.");
    expect(result.chunks).toEqual(["Intro."]);
    expect(result.remainder).toBe("```js\nfunction test() { return true; }\n// More code.");
  });

  it("simulates streaming across multiple calls with a running buffer", () => {
    // First call: partial sentence
    const first = extractSpeakableChunks("Hello");
    expect(first.chunks).toEqual([]);
    expect(first.remainder).toBe("Hello");

    // Second call: add more text, completing a sentence
    const second = extractSpeakableChunks(first.remainder + " world.");
    expect(second.chunks).toEqual(["Hello world."]);
    expect(second.remainder).toBe("");

    // Third call: add more incomplete text
    const third = extractSpeakableChunks(second.remainder + "More text");
    expect(third.chunks).toEqual([]);
    expect(third.remainder).toBe("More text");
  });

  it("handles empty input without throwing", () => {
    const result = extractSpeakableChunks("");
    expect(result.chunks).toEqual([]);
    expect(result.remainder).toBe("");
  });

  it("handles a closed fence followed by more prose", () => {
    const result = extractSpeakableChunks("Text before. ```\ncode\n``` Text after. More text");
    expect(result.chunks).toEqual(["Text before.", "Text after."]);
    expect(result.remainder).toBe("More text");
  });

  it("handles multiple closed fences in sequence", () => {
    const result = extractSpeakableChunks("A. ```\ncode1\n``` B. ```\ncode2\n``` C.");
    expect(result.chunks).toEqual(["A.", "B.", "C."]);
    expect(result.remainder).toBe("");
  });

  it("strips an earlier closed fence's content even when a later fence is still unclosed", () => {
    // Regression case: a naive "only look at the last fence marker" approach
    // leaves the first (already-closed) fence's raw backticks and code
    // leaking into a spoken chunk instead of being dropped.
    const result = extractSpeakableChunks("Intro text. ```js\ncode one\n``` Middle text. ```js\nunclosed code here");
    expect(result.chunks).toEqual(["Intro text.", "Middle text."]);
    expect(result.chunks.join(" ")).not.toContain("```");
    expect(result.chunks.join(" ")).not.toContain("code one");
    expect(result.remainder).toBe("```js\nunclosed code here");
  });
});
