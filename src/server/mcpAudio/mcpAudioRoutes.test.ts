import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerMcpAudioRoutes } from "./mcpAudioRoutes.js";

let app: FastifyInstance;
let audioDir: string;

beforeEach(async () => {
  audioDir = await mkdtemp(join(tmpdir(), "pi-web-mcp-audio-routes-"));
  await writeFile(join(audioDir, "clip.mp3"), "audio-bytes");
  app = Fastify({ logger: false });
  registerMcpAudioRoutes(app, { audioDir });
});

afterEach(async () => {
  await app.close();
  await rm(audioDir, { recursive: true, force: true });
});

describe("GET /api/mcp-audio/:filename", () => {
  it("serves the file with the matching content type", async () => {
    const response = await app.inject({ method: "GET", url: "/api/mcp-audio/clip.mp3" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("audio/mpeg");
    expect(response.body).toBe("audio-bytes");
  });

  it("404s for a filename that does not exist", async () => {
    const response = await app.inject({ method: "GET", url: "/api/mcp-audio/missing.mp3" });
    expect(response.statusCode).toBe(404);
  });

  it("400s for a filename outside the allowlist", async () => {
    const response = await app.inject({ method: "GET", url: "/api/mcp-audio/not%20safe.mp3" });
    expect(response.statusCode).toBe(400);
  });

  it("404s for a traversal attempt encoded in the path segment", async () => {
    const response = await app.inject({ method: "GET", url: "/api/mcp-audio/..%2Fescape.mp3" });
    expect(response.statusCode).toBe(400);
  });
});
