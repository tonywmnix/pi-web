import { describe, expect, it, vi } from "vitest";
import { PromptNotificationController } from "./promptNotificationController";
import type { BrowserNotificationGateway } from "../browserNotificationGateway";
import type { PendingAskUser, SessionStatus } from "../../../shared/apiTypes";

function baseStatus(overrides: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "s1",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...overrides,
  };
}

function ask(askId: string, question = "Proceed?"): PendingAskUser {
  return { askId, askedAt: new Date().toISOString(), questions: [{ id: "q1", question, options: [] }] };
}

function fakeGateway(overrides: Partial<BrowserNotificationGateway> = {}): BrowserNotificationGateway & { shown: { title: string; body: string; tag: string; onActivate: () => void }[] } {
  const shown: { title: string; body: string; tag: string; onActivate: () => void }[] = [];
  return {
    isSupported: () => true,
    ensurePermission: () => Promise.resolve("granted"),
    claim: () => Promise.resolve(true),
    show: (options) => { shown.push(options); },
    shown,
    ...overrides,
  };
}

describe("PromptNotificationController", () => {
  it("shows a notification for a newly opened ask", async () => {
    const gateway = fakeGateway();
    const onActivate = vi.fn();
    const controller = new PromptNotificationController({ gateway, onActivate });
    controller.handleStatusUpdate("machine-1", baseStatus({ pendingAsk: ask("a1", "Deploy now?") }));
    await flush();
    expect(gateway.shown).toHaveLength(1);
    expect(gateway.shown[0]?.title).toBe("Question waiting");
    expect(gateway.shown[0]?.body).toBe("Deploy now?");
  });

  it("does not re-notify for the same ask on a later status update", async () => {
    const gateway = fakeGateway();
    const controller = new PromptNotificationController({ gateway, onActivate: vi.fn() });
    controller.handleStatusUpdate("machine-1", baseStatus({ pendingAsk: ask("a1") }));
    await flush();
    controller.handleStatusUpdate("machine-1", baseStatus({ pendingAsk: ask("a1"), isStreaming: true }));
    await flush();
    expect(gateway.shown).toHaveLength(1);
  });

  it("skips showing when permission is not granted", async () => {
    const gateway = fakeGateway({ ensurePermission: () => Promise.resolve("denied") });
    const controller = new PromptNotificationController({ gateway, onActivate: vi.fn() });
    controller.handleStatusUpdate("machine-1", baseStatus({ pendingAsk: ask("a1") }));
    await flush();
    expect(gateway.shown).toHaveLength(0);
  });

  it("skips showing when another tab claims the prompt first", async () => {
    const gateway = fakeGateway({ claim: () => Promise.resolve(false) });
    const controller = new PromptNotificationController({ gateway, onActivate: vi.fn() });
    controller.handleStatusUpdate("machine-1", baseStatus({ pendingAsk: ask("a1") }));
    await flush();
    expect(gateway.shown).toHaveLength(0);
  });

  it("invokes onActivate with the machine and session id when the notification is clicked", async () => {
    const gateway = fakeGateway();
    const onActivate = vi.fn();
    const controller = new PromptNotificationController({ gateway, onActivate });
    controller.handleStatusUpdate("machine-1", baseStatus({ sessionId: "s42", pendingAsk: ask("a1") }));
    await flush();
    gateway.shown[0]?.onActivate();
    expect(onActivate).toHaveBeenCalledWith({ machineId: "machine-1", sessionId: "s42" });
  });

  it("requests permission at most once even if ensurePermissionRequested is called repeatedly", () => {
    const ensurePermission = vi.fn(() => Promise.resolve<NotificationPermission>("granted"));
    const gateway = fakeGateway({ ensurePermission });
    const controller = new PromptNotificationController({ gateway, onActivate: vi.fn() });
    controller.ensurePermissionRequested();
    controller.ensurePermissionRequested();
    expect(ensurePermission).toHaveBeenCalledTimes(1);
  });

  it("shows a notification when a session finishes its turn", async () => {
    const gateway = fakeGateway();
    const controller = new PromptNotificationController({ gateway, onActivate: vi.fn() });
    controller.handleStatusUpdate("machine-1", baseStatus({ isStreaming: true }));
    await flush();
    controller.handleStatusUpdate("machine-1", baseStatus({ isStreaming: false }));
    await flush();
    expect(gateway.shown).toHaveLength(1);
    expect(gateway.shown[0]?.title).toBe("pi-web is done");
  });

  it("does not show a done notification when the turn ends by opening an ask", async () => {
    const gateway = fakeGateway();
    const controller = new PromptNotificationController({ gateway, onActivate: vi.fn() });
    controller.handleStatusUpdate("machine-1", baseStatus({ isStreaming: true }));
    await flush();
    controller.handleStatusUpdate("machine-1", baseStatus({ isStreaming: false, pendingAsk: ask("a1") }));
    await flush();
    expect(gateway.shown).toHaveLength(1);
    expect(gateway.shown[0]?.title).toBe("Question waiting");
  });

  it("reports gateway failures via onBackgroundError instead of throwing", async () => {
    const gateway = fakeGateway({ ensurePermission: () => Promise.reject(new Error("boom")) });
    const onBackgroundError = vi.fn();
    const controller = new PromptNotificationController({ gateway, onActivate: vi.fn(), onBackgroundError });
    controller.handleStatusUpdate("machine-1", baseStatus({ pendingAsk: ask("a1") }));
    await flush();
    expect(onBackgroundError).toHaveBeenCalledWith(expect.stringContaining("s1"), expect.any(Error));
  });
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
