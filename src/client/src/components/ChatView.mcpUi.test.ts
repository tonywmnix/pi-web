import type { TemplateResult } from "lit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatLine } from "./shared";
import { ChatView } from "./ChatView";
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

// Same escape hatch as ChatView.mcpAudio.test.ts: `UI_HTML_FILE:` is a workaround for the
// MCP/session pipeline having no resource content-part type, so the only place that wiring is
// observable is the rendered toolResult template.
describe("ChatView tool-result UI resource marker rendering", () => {
  it("renders a sandboxed iframe with the resolved URL and strips the marker line from the visible text", () => {
    const view = new ChatView();
    const part = {
      type: "toolResult",
      toolName: "render_widget",
      text: "Generated a widget.\nUI_HTML_FILE: widget.html\nDone.",
      isError: false,
    } as const;

    const rendered = renderPart(view, part);

    expect(templateValueAfterMarker(rendered, "src=")).toBe(resolveMcpUiUrl("widget.html"));
    expect(templateText(rendered)).toContain("Generated a widget.");
    expect(templateText(rendered)).toContain("Done.");
    expect(templateText(rendered)).not.toContain("UI_HTML_FILE:");
  });

  it("renders no iframe when the tool result has no marker", () => {
    const view = new ChatView();
    const part = { type: "toolResult", toolName: "read", text: "plain output", isError: false } as const;

    const rendered = renderPart(view, part);

    expect(() => templateValueAfterMarker(rendered, "src=")).toThrow();
    expect(templateText(rendered)).toContain("plain output");
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
