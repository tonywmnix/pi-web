import { afterEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

afterEach(() => {
  vi.unstubAllEnvs();
});

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
}

/** A session whose abort parks until the test releases it, as a long turn does. */
function slowAbortSession(sessionId: string) {
  const unwind = deferred();
  let abortCalls = 0;
  const fake = fakeRuntime(sessionId, {
    abort: () => {
      abortCalls += 1;
      return unwind.promise;
    },
  });
  return { fake, unwind, abortCalls: () => abortCalls };
}

function serviceFor(fake: ReturnType<typeof fakeRuntime>, sessionId: string, hub = new CapturingSessionEventHub()) {
  const service = new PiSessionService(hub, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord(sessionId)]),
    heartbeatIntervalMs: 60_000,
  });
  return { service, hub };
}

describe("PiSessionService requestAbort", () => {
  it("answers immediately while the turn is still unwinding", async () => {
    const { fake, unwind, abortCalls } = slowAbortSession("slow-abort");
    const { service } = serviceFor(fake, "slow-abort");
    await service.prompt(sessionRef("slow-abort"), "start work");

    // The turn has not finished; this must still return rather than park.
    const result = service.requestAbort(sessionRef("slow-abort"));

    expect(result).toEqual({ aborted: true, pending: true });
    expect(abortCalls()).toBe(1);

    unwind.resolve();
    await service.dispose();
  });

  it("does not start a second unwind when stop is pressed repeatedly", async () => {
    const { fake, unwind, abortCalls } = slowAbortSession("repeat-abort");
    const { service } = serviceFor(fake, "repeat-abort");
    await service.prompt(sessionRef("repeat-abort"), "start work");

    const first = service.requestAbort(sessionRef("repeat-abort"));
    const second = service.requestAbort(sessionRef("repeat-abort"));
    const third = service.requestAbort(sessionRef("repeat-abort"));

    expect([first, second, third]).toEqual([
      { aborted: true, pending: true },
      { aborted: true, pending: true },
      { aborted: true, pending: true },
    ]);
    // The whole point: extra presses cost nothing on the server either.
    expect(abortCalls()).toBe(1);

    unwind.resolve();
    await service.dispose();
  });

  it("accepts a fresh abort once the previous unwind has settled", async () => {
    const { fake, unwind, abortCalls } = slowAbortSession("sequential-abort");
    const { service } = serviceFor(fake, "sequential-abort");
    await service.prompt(sessionRef("sequential-abort"), "start work");

    service.requestAbort(sessionRef("sequential-abort"));
    unwind.resolve();
    // Let the unwind settle and clear its in-flight entry.
    await new Promise((resolve) => setTimeout(resolve, 0));

    service.requestAbort(sessionRef("sequential-abort"));

    expect(abortCalls()).toBe(2);
    await service.dispose();
  });

  it("publishes status when the request lands and again when the unwind settles", async () => {
    const { fake, unwind } = slowAbortSession("status-abort");
    const { service, hub } = serviceFor(fake, "status-abort");
    await service.prompt(sessionRef("status-abort"), "start work");
    const before = hub.sessionEvents.filter(({ event }) => event.type === "status.update").length;

    service.requestAbort(sessionRef("status-abort"));
    const afterRequest = hub.sessionEvents.filter(({ event }) => event.type === "status.update").length;

    // The browser learns the request landed without waiting for the unwind.
    expect(afterRequest).toBeGreaterThan(before);

    unwind.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(hub.sessionEvents.filter(({ event }) => event.type === "status.update").length).toBeGreaterThan(afterRequest);
    await service.dispose();
  });

  it("reports a failed unwind as activity instead of rejecting into nothing", async () => {
    // Fails the first abort only; dispose() aborts again during teardown and a
    // permanently rejecting fake would fail the test on cleanup, not on the
    // behaviour under test.
    let attempts = 0;
    const fake = fakeRuntime("failing-abort", {
      abort: () => {
        attempts += 1;
        return attempts === 1 ? Promise.reject(new Error("runtime refused to stop")) : Promise.resolve();
      },
    });
    const { service, hub } = serviceFor(fake, "failing-abort");
    await service.prompt(sessionRef("failing-abort"), "start work");

    // Nothing awaits the unwind, so a rejection must be handled internally
    // rather than surfacing as an unhandled rejection.
    expect(() => service.requestAbort(sessionRef("failing-abort"))).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const activities = hub.sessionEvents.filter(({ event }) => event.type === "activity.update");
    expect(JSON.stringify(activities)).toContain("stop failed");
    await service.dispose();
  });

  it("reports no pending unwind for a session that is not active", () => {
    const fake = fakeRuntime("inactive-abort");
    const { service } = serviceFor(fake, "inactive-abort");

    expect(service.requestAbort(sessionRef("never-started"))).toEqual({ aborted: true, pending: false });
  });
});
