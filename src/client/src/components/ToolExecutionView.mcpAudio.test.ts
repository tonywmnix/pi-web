import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToolExecutionView } from "./ToolExecutionView";
import { resolveMcpAudioUrl } from "../api/urls";
import { templateText, templateValueAfterMarker } from "../templateInspection.testSupport";

beforeEach(() => {
  vi.stubEnv("BASE_URL", "./");
  vi.stubGlobal("document", { baseURI: "https://pi.example.test/" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// Same escape hatch as ChatView.mcpAudio.test.ts: this is the actual card rendered for a
// normal tool call/result pair (mcp gateway calls merge into a toolExecution part, not a
// standalone toolResult part), so the marker must be detected here too, not only in
// ChatView's passthrough toolResult branch.
describe("ToolExecutionView audio marker rendering", () => {
  it("renders an audio widget with the resolved URL and strips the marker line from the visible text", () => {
    const view = new ToolExecutionView();
    view.execution = {
      type: "toolExecution",
      toolName: "mcp",
      summary: "tool: generate_music",
      status: "success",
      resultText: "[Audio content: audio/mpeg]\nAUDIO_FILE: clip.mp3\nSaved audio to /out/clip.mp3\nModel: google/lyria-3-clip-preview",
    };

    const rendered = view.render();
    if (rendered === null) throw new Error("expected a rendered template");

    expect(templateValueAfterMarker(rendered, "src=")).toBe(resolveMcpAudioUrl("clip.mp3"));
    expect(templateText(rendered)).toContain("Saved audio to /out/clip.mp3");
    expect(templateText(rendered)).toContain("[Audio content: audio/mpeg]");
    expect(templateText(rendered)).not.toContain("AUDIO_FILE:");
  });

  it("renders no audio widget when the tool result has no marker", () => {
    const view = new ToolExecutionView();
    view.execution = { type: "toolExecution", toolName: "read", summary: "src/app.ts", status: "success", resultText: "plain output" };

    const rendered = view.render();
    if (rendered === null) throw new Error("expected a rendered template");

    expect(() => templateValueAfterMarker(rendered, "src=")).toThrow();
    expect(templateText(rendered)).toContain("plain output");
  });
});
