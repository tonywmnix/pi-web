import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_AUDIO_DIR,
  isValidMcpAudioFilename,
  mcpAudioContentType,
  mcpAudioDir,
  McpAudioFileNotFoundError,
  McpAudioInvalidFilenameError,
  resolveMcpAudioFilePath,
} from "./mcpAudioFileService.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("mcpAudioDir", () => {
  it("uses PI_WEB_MCP_AUDIO_DIR when set", () => {
    expect(mcpAudioDir({ PI_WEB_MCP_AUDIO_DIR: "/configured/output" })).toBe("/configured/output");
  });

  it("falls back to the openrouter-audio-mcp default output directory", () => {
    expect(mcpAudioDir({})).toBe(DEFAULT_MCP_AUDIO_DIR);
  });

  it("treats an empty env value the same as unset", () => {
    expect(mcpAudioDir({ PI_WEB_MCP_AUDIO_DIR: "" })).toBe(DEFAULT_MCP_AUDIO_DIR);
  });
});

describe("isValidMcpAudioFilename", () => {
  it("accepts a basename-only filename", () => {
    expect(isValidMcpAudioFilename("2026-08-21T03-36-33-985Z_hexgrad_kokoro-82m.mp3")).toBe(true);
  });

  it.each(["../secret.mp3", "sub/dir.mp3", "sub\\dir.mp3", "..", "a/../b.mp3", ""])("rejects %s", (filename) => {
    expect(isValidMcpAudioFilename(filename)).toBe(false);
  });
});

describe("mcpAudioContentType", () => {
  it.each([
    ["clip.mp3", "audio/mpeg"],
    ["clip.MP3", "audio/mpeg"],
    ["clip.wav", "audio/wave"],
    ["clip.pcm", "audio/pcm"],
    ["clip.bin", "application/octet-stream"],
    ["clip", "application/octet-stream"],
  ])("maps %s to %s", (filename, expected) => {
    expect(mcpAudioContentType(filename)).toBe(expected);
  });
});

describe("resolveMcpAudioFilePath", () => {
  async function tempAudioDir(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "pi-web-mcp-audio-"));
    tempRoots.push(root);
    return root;
  }

  it("resolves a file that exists inside the directory", async () => {
    const dir = await tempAudioDir();
    await writeFile(join(dir, "clip.mp3"), "audio-bytes");
    await expect(resolveMcpAudioFilePath(dir, "clip.mp3")).resolves.toBe(join(dir, "clip.mp3"));
  });

  it("rejects a filename that fails the allowlist before touching the filesystem", async () => {
    const dir = await tempAudioDir();
    await expect(resolveMcpAudioFilePath(dir, "../clip.mp3")).rejects.toBeInstanceOf(McpAudioInvalidFilenameError);
  });

  it("reports a missing file as not found", async () => {
    const dir = await tempAudioDir();
    await expect(resolveMcpAudioFilePath(dir, "missing.mp3")).rejects.toBeInstanceOf(McpAudioFileNotFoundError);
  });

  it("reports a missing base directory as not found", async () => {
    await expect(resolveMcpAudioFilePath(join(tmpdir(), "pi-web-mcp-audio-does-not-exist"), "clip.mp3")).rejects.toBeInstanceOf(McpAudioFileNotFoundError);
  });

  it("rejects a directory entry even if named like a file", async () => {
    const dir = await tempAudioDir();
    await mkdir(join(dir, "clip.mp3"));
    await expect(resolveMcpAudioFilePath(dir, "clip.mp3")).rejects.toBeInstanceOf(McpAudioFileNotFoundError);
  });

  it("rejects a validly-named symlink that escapes the configured directory", async () => {
    const dir = await tempAudioDir();
    const outside = await tempAudioDir();
    await writeFile(join(outside, "secret.mp3"), "secret-bytes");
    await symlink(join(outside, "secret.mp3"), join(dir, "escape.mp3"));
    await expect(resolveMcpAudioFilePath(dir, "escape.mp3")).rejects.toThrow("Path escapes workspace");
  });
});
