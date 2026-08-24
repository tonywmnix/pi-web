import { describe, expect, it } from "vitest";
import { parseMcpUiMarker } from "./mcpUiMarker";

describe("parseMcpUiMarker", () => {
  it("extracts the filename and strips the marker line", () => {
    const text = "Generated a widget.\nUI_HTML_FILE: 2026-08-21T03-36-33-985Z_widget.html\nDone.";
    expect(parseMcpUiMarker(text)).toEqual({
      filename: "2026-08-21T03-36-33-985Z_widget.html",
      textWithoutMarker: "Generated a widget.\nDone.",
    });
  });

  it("returns undefined when there is no marker", () => {
    expect(parseMcpUiMarker("just some regular tool output")).toBeUndefined();
  });

  it("tolerates surrounding whitespace on the marker line", () => {
    const text = "  UI_HTML_FILE: widget.html  \n";
    expect(parseMcpUiMarker(text)).toEqual({ filename: "widget.html", textWithoutMarker: "" });
  });

  it("ignores a marker line with no filename", () => {
    expect(parseMcpUiMarker("UI_HTML_FILE: \nother text")).toBeUndefined();
  });

  it("uses the first marker when more than one is present", () => {
    const text = "UI_HTML_FILE: first.html\nUI_HTML_FILE: second.html";
    expect(parseMcpUiMarker(text)?.filename).toBe("first.html");
  });
});
