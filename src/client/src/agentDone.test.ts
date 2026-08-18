import { describe, expect, it } from "vitest";
import type { SessionActivity } from "./api";
import { SessionDoneTracker, activityIsWorking } from "./agentDone";

function activity(sessionId: string, phase: SessionActivity["phase"], overrides: Partial<SessionActivity> = {}): SessionActivity {
  return { sessionId, phase, label: phase, at: "2026-08-18T00:00:00.000Z", ...overrides };
}

describe("activityIsWorking", () => {
  it("counts an active phase as working", () => {
    expect(activityIsWorking(activity("s", "active"))).toBe(true);
  });

  it("does not count startup, which is active but is not work in the session", () => {
    expect(activityIsWorking(activity("s", "active", { startup: true }))).toBe(false);
  });

  it("does not count idle or error", () => {
    expect(activityIsWorking(activity("s", "idle"))).toBe(false);
    expect(activityIsWorking(activity("s", "error"))).toBe(false);
  });
});

describe("SessionDoneTracker", () => {
  it("fires when a working session goes idle", () => {
    const tracker = new SessionDoneTracker();
    tracker.observe(activity("s1", "active"));

    expect(tracker.observe(activity("s1", "idle"))).toBe(true);
  });

  it("fires once, not on every later idle report", () => {
    const tracker = new SessionDoneTracker();
    tracker.observe(activity("s1", "active"));

    expect(tracker.observe(activity("s1", "idle"))).toBe(true);
    expect(tracker.observe(activity("s1", "idle"))).toBe(false);
  });

  it("stays quiet for a session first seen idle, so a refresh announces nothing", () => {
    const tracker = new SessionDoneTracker();

    expect(tracker.observe(activity("s1", "idle"))).toBe(false);
  });

  it("treats an error as finished, since the agent has stopped either way", () => {
    const tracker = new SessionDoneTracker();
    tracker.observe(activity("s1", "active"));

    expect(tracker.observe(activity("s1", "error"))).toBe(true);
  });

  it("does not announce a session that merely finished starting up", () => {
    const tracker = new SessionDoneTracker();
    // Startup reports arrive as active; going idle afterwards is not a finished run.
    tracker.observe(activity("s1", "active", { startup: true }));

    expect(tracker.observe(activity("s1", "idle"))).toBe(false);
  });

  it("fires again for a second run", () => {
    const tracker = new SessionDoneTracker();
    tracker.observe(activity("s1", "active"));
    expect(tracker.observe(activity("s1", "idle"))).toBe(true);

    tracker.observe(activity("s1", "active"));
    expect(tracker.observe(activity("s1", "idle"))).toBe(true);
  });

  it("tracks sessions independently", () => {
    const tracker = new SessionDoneTracker();
    tracker.observe(activity("s1", "active"));

    expect(tracker.observe(activity("s2", "idle"))).toBe(false);
    expect(tracker.observe(activity("s1", "idle"))).toBe(true);
  });

  it("treats a forgotten session as newly seen", () => {
    const tracker = new SessionDoneTracker();
    tracker.observe(activity("s1", "active"));
    tracker.forget("s1");

    expect(tracker.observe(activity("s1", "idle"))).toBe(false);
  });
});
