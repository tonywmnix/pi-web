import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerMcpUiRoutes } from "./mcpUiRoutes.js";

let app: FastifyInstance;
let uiDir: string;

beforeEach(async () => {
  uiDir = await mkdtemp(join(tmpdir(), "pi-web-mcp-ui-routes-"));
  await writeFile(join(uiDir, "widget.html"), "<p>hi</p>");
  app = Fastify({ logger: false });
  registerMcpUiRoutes(app, { uiDir });
});

afterEach(async () => {
  await app.close();
  await rm(uiDir, { recursive: true, force: true });
});

describe("GET /api/mcp-ui/:filename", () => {
  it("serves the file as HTML with framing/CSP headers locked down", async () => {
    const response = await app.inject({ method: "GET", url: "/api/mcp-ui/widget.html" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'self'");
    expect(response.body).toBe("<p>hi</p>");
  });

  it("404s for a filename that does not exist", async () => {
    const response = await app.inject({ method: "GET", url: "/api/mcp-ui/missing.html" });
    expect(response.statusCode).toBe(404);
  });

  it("400s for a filename outside the allowlist", async () => {
    const response = await app.inject({ method: "GET", url: "/api/mcp-ui/widget.js" });
    expect(response.statusCode).toBe(400);
  });

  it("404s for a traversal attempt encoded in the path segment", async () => {
    const response = await app.inject({ method: "GET", url: "/api/mcp-ui/..%2Fescape.html" });
    expect(response.statusCode).toBe(400);
  });
});
