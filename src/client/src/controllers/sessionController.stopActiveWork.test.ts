import { describe, expect, it } from "vitest";
import { initialAppState } from "../appState";
import { SessionController } from "./sessionController";
import { defaultApi, deferred, FakeSocket, oldSession, sessionLookupId, workspace, type AppState } from "./sessionController.testSupport";

function controllerFor(state: () => AppState, apply: (patch: Partial<AppState>) => void, api: typeof defaultApi): SessionController {
  return new SessionController(state, apply, () => undefined, undefined, { api, socket: new FakeSocket() });
}

describe("SessionController stopActiveWork", () => {
  /**
   * The daemon answers an abort only once the turn has unwound, which on a
   * stalled model stream takes as long as the provider timeout. Each extra
   * in-flight request consumes one of the browser's limited per-origin
   * connections, so an undeduplicated stop button can starve every other poll in
   * the app and make the whole UI look frozen.
   */
  it("issues one request no matter how many times stop is pressed while it is in flight", async () => {
    const request = deferred<{ aborted: true }>();
    const abortCalls: string[] = [];
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      abort: (session) => {
        abortCalls.push(sessionLookupId(session));
        return request.promise;
      },
    };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, api);

    const first = controller.stopActiveWork();
    await controller.stopActiveWork();
    await controller.stopActiveWork();
    await controller.stopActiveWork();

    expect(abortCalls).toEqual([oldSession.id]);
    expect(state.stoppingSessions[oldSession.id]).toBe(true);

    request.resolve({ aborted: true });
    await first;

    expect(state.stoppingSessions[oldSession.id]).toBeUndefined();
  });

  it("allows a retry once the previous stop has answered", async () => {
    const abortCalls: string[] = [];
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
    };
    const api: typeof defaultApi = {
      ...defaultApi,
      abort: (session) => {
        abortCalls.push(sessionLookupId(session));
        return Promise.resolve({ aborted: true } as const);
      },
    };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, api);

    await controller.stopActiveWork();
    await controller.stopActiveWork();

    expect(abortCalls).toEqual([oldSession.id, oldSession.id]);
  });

  it("clears the in-flight marker when the request fails, so stop stays usable", async () => {
    let state: AppState = {
      ...initialAppState(),
      selectedWorkspace: workspace,
      selectedSession: oldSession,
      sessions: [oldSession],
    };
    const api: typeof defaultApi = { ...defaultApi, abort: () => Promise.reject(new Error("daemon unreachable")) };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, api);

    await controller.stopActiveWork();

    expect(state.stoppingSessions[oldSession.id]).toBeUndefined();
    expect(state.error).toContain("daemon unreachable");
  });

  it("does nothing when no session is selected", async () => {
    const abortCalls: string[] = [];
    let state: AppState = { ...initialAppState(), selectedWorkspace: workspace };
    const api: typeof defaultApi = {
      ...defaultApi,
      abort: (session) => {
        abortCalls.push(sessionLookupId(session));
        return Promise.resolve({ aborted: true } as const);
      },
    };
    const controller = controllerFor(() => state, (patch) => { state = { ...state, ...patch }; }, api);

    await controller.stopActiveWork();

    expect(abortCalls).toEqual([]);
  });
});
