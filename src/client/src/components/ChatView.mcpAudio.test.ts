import type { TemplateResult } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatLine } from "./shared";
import { ChatView } from "./ChatView";
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

// Escape hatch: the `AUDIO_FILE:` marker is deliberately a workaround for the
// MCP/session pipeline having no audio content-part type, so the only place
// that wiring is observable is the rendered toolResult template. A happy-dom
// harness would add setup for a single attribute/text assertion; direct
// TemplateResult inspection anchored to the stable `src=`/`class=` markup is
// proportionate here (content wiring, not event handling).
describe("ChatView tool-result audio marker rendering", () => {
  it("renders an audio widget with the resolved URL and strips the marker line from the visible text", () => {
    const view = new ChatView();
    const part = {
      type: "toolResult",
      toolName: "generate_audio",
      text: "Generated audio.\nAUDIO_FILE: clip.mp3\nDone.",
      isError: false,
    } as const;

    const rendered = renderPart(view, part);

    expect(templateValueAfterMarker(rendered, "src=")).toBe(resolveMcpAudioUrl("clip.mp3"));
    expect(templateText(rendered)).toContain("Generated audio.");
    expect(templateText(rendered)).toContain("Done.");
    expect(templateText(rendered)).not.toContain("AUDIO_FILE:");
  });

  it("renders no audio widget when the tool result has no marker", () => {
    const view = new ChatView();
    const part = { type: "toolResult", toolName: "read", text: "plain output", isError: false } as const;

    const rendered = renderPart(view, part);

    expect(() => templateValueAfterMarker(rendered, "src=")).toThrow();
    expect(templateText(rendered)).toContain("plain output");
  });

  // The `audio` part is chatMessages.ts's promoted duplicate of a tool result's AUDIO_FILE
  // marker, attached directly to the assistant's own reply so it isn't hidden behind the
  // collapsed "events" group. It carries only a filename -- the widget is built the same way
  // as the toolResult/toolExecution marker widgets, just from a dedicated part type instead of
  // parsing a text marker at render time.
  it("renders an audio widget for a promoted audio part on an assistant reply", () => {
    const view = new ChatView();
    const part = { type: "audio", filename: "clip.mp3" } as const;

    const rendered = renderPart(view, part);

    expect(templateValueAfterMarker(rendered, "src=")).toBe(resolveMcpAudioUrl("clip.mp3"));
  });
});

type RenderPart = (this: ChatView, part: ChatLine["parts"][number], message?: ChatLine) => TemplateResult;

function renderPart(view: ChatView, part: ChatLine["parts"][number], message?: ChatLine): TemplateResult {
  const method: unknown = Reflect.get(view, "renderPart");
  if (!isRenderPart(method)) throw new Error("ChatView.renderPart is not callable");
  return method.call(view, part, message);
}

function isRenderPart(value: unknown): value is RenderPart {
  return typeof value === "function";
}
