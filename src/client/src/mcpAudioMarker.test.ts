import { describe, expect, it } from "vitest";
import { parseMcpAudioMarker } from "./mcpAudioMarker";

describe("parseMcpAudioMarker", () => {
  it("extracts the filename and strips the marker line", () => {
    const text = "Generated audio.\nAUDIO_FILE: 2026-08-21T03-36-33-985Z_hexgrad_kokoro-82m.mp3\nDone.";
    expect(parseMcpAudioMarker(text)).toEqual({
      filename: "2026-08-21T03-36-33-985Z_hexgrad_kokoro-82m.mp3",
      textWithoutMarker: "Generated audio.\nDone.",
    });
  });

  it("returns undefined when there is no marker", () => {
    expect(parseMcpAudioMarker("just some regular tool output")).toBeUndefined();
  });

  it("tolerates surrounding whitespace on the marker line", () => {
    const text = "  AUDIO_FILE: clip.mp3  \n";
    expect(parseMcpAudioMarker(text)).toEqual({ filename: "clip.mp3", textWithoutMarker: "" });
  });

  it("ignores a marker line with no filename", () => {
    expect(parseMcpAudioMarker("AUDIO_FILE: \nother text")).toBeUndefined();
  });

  it("uses the first marker when more than one is present", () => {
    const text = "AUDIO_FILE: first.mp3\nAUDIO_FILE: second.mp3";
    expect(parseMcpAudioMarker(text)?.filename).toBe("first.mp3");
  });
});
