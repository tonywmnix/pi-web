import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { FakeSocket, oldSession, status, workspace, type AppState, type SessionStatus } from "./sessionController.testSupport";

type Machine = NonNullable<AppState["selectedMachine"]>;

interface AlertCall {
  kind: string;
  sessionId: string;
  sessionLabel: string;
  machineLabel: string | undefined;
}

function askingStatus(sessionId: string): SessionStatus {
  return {
    ...status(sessionId),
    pendingAsk: { askId: "ask-1", askedAt: "2026-08-18T00:00:00.000Z", questions: [{ id: "q1", question: "Ship it?", options: [] }] },
  };
}

function controllerFor(machine: Machine | undefined, calls: AlertCall[]): SessionController {
  const state: AppState = {
    ...initialAppState(),
    ...(machine === undefined ? {} : { selectedMachine: machine }),
    selectedWorkspace: workspace,
    selectedSession: oldSession,
    sessions: [oldSession],
  };
  return new SessionController(
    () => state,
    () => undefined,
    () => undefined,
    undefined,
    {
      socket: new FakeSocket(),
      playAskSound: () => undefined,
      notifyAgentEvent: (kind, sessionId, sessionLabel, machineLabel) => {
        calls.push({ kind, sessionId, sessionLabel, machineLabel });
      },
    },
  );
}

/** Transition into waiting: the first status is recorded silently by design. */
function driveIntoWaiting(controller: SessionController): void {
  controller.applyGlobalEvent({ type: "status.update", status: status(oldSession.id) });
  controller.applyGlobalEvent({ type: "status.update", status: askingStatus(oldSession.id) });
}

describe("SessionController agent alerts", () => {
  it("names the host the run is on, not the display name", () => {
    // "Local" is the same string on every gateway, so the hostname is the only
    // part that answers which machine raised the notification.
    const calls: AlertCall[] = [];
    const controller = controllerFor(
      { id: "local", name: "Local", kind: "local", hostname: "build-box", createdAt: "now", updatedAt: "now" },
      calls,
    );

    driveIntoWaiting(controller);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe("question");
    expect(calls[0]?.machineLabel).toBe("build-box");
  });

  it("falls back to the chosen name for a remote that reports no host", () => {
    const calls: AlertCall[] = [];
    const controller = controllerFor(
      { id: "remote-a", name: "Build box", kind: "remote", createdAt: "now", updatedAt: "now" },
      calls,
    );

    driveIntoWaiting(controller);

    expect(calls[0]?.machineLabel).toBe("Build box");
  });

  it("still alerts when no machine is selected", () => {
    const calls: AlertCall[] = [];
    const controller = controllerFor(undefined, calls);

    driveIntoWaiting(controller);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.machineLabel).toBeUndefined();
  });
});
