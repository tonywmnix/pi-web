import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolExecutionView } from "./ToolExecutionView";
import { resolveMcpUiUrl } from "../api/urls";
import { templateText, templateValueAfterMarker } from "../templateInspection.testSupport";

beforeEach(() => {
  vi.stubEnv("BASE_URL", "./");
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Same escape hatch as ToolExecutionView.mcpAudio.test.ts: this is the actual card rendered for
// a normal tool call/result pair (mcp gateway calls merge into a toolExecution part, not a
// standalone toolResult part), so the marker must be detected here too.
describe("ToolExecutionView UI resource marker rendering", () => {
  it("renders a sandboxed iframe with the resolved URL and strips the marker line from the visible text", () => {
    const view = new ToolExecutionView();
    view.execution = {
      type: "toolExecution",
      toolName: "mcp",
      summary: "tool: render_widget",
      status: "success",
      resultText: "Building dashboard.\nUI_HTML_FILE: widget.html\nSaved widget to /out/widget.html",
    };

    const rendered = view.render();
    if (rendered === null) throw new Error("expected a rendered template");

    expect(templateValueAfterMarker(rendered, "src=")).toBe(resolveMcpUiUrl("widget.html"));
    expect(templateText(rendered)).toContain("Saved widget to /out/widget.html");
    expect(templateText(rendered)).toContain("Building dashboard.");
    expect(templateText(rendered)).not.toContain("UI_HTML_FILE:");
  });

  it("renders no iframe when the tool result has no marker", () => {
    const view = new ToolExecutionView();
    view.execution = { type: "toolExecution", toolName: "read", summary: "src/app.ts", status: "success", resultText: "plain output" };

    const rendered = view.render();
    if (rendered === null) throw new Error("expected a rendered template");

    expect(() => templateValueAfterMarker(rendered, "src=")).toThrow();
    expect(templateText(rendered)).toContain("plain output");
  });

  it("prefers the audio marker over a UI marker when both are somehow present", () => {
    const view = new ToolExecutionView();
    view.execution = {
      type: "toolExecution",
      toolName: "mcp",
      summary: "tool: generate_music",
      status: "success",
      resultText: "AUDIO_FILE: clip.mp3\nUI_HTML_FILE: widget.html",
    };

    const rendered = view.render();
    if (rendered === null) throw new Error("expected a rendered template");

    expect(templateText(rendered)).toContain("UI_HTML_FILE: widget.html");
  });
});
