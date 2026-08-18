import { resolveAppUrl } from "./appUrl";

/**
 * Thin adapter over the browser `Notification`, Service Worker, and Web Locks
 * APIs. Kept separate from {@link PromptNotificationController} so the
 * orchestration logic can be unit-tested with a fake gateway instead of real
 * browser globals.
 */
export interface BrowserNotificationGateway {
  /** Whether this browser can show notifications at all. */
  isSupported(): boolean;
  /** Requests permission once, if not already granted or denied. Never prompts twice. */
  ensurePermission(): Promise<NotificationPermission>;
  /**
   * Cross-tab dedupe for one prompt id: resolves `true` for at most one tab
   * among every same-origin tab racing this id at the same time, `false` for
   * the rest. Falls back to `true` (always notify) when the Web Locks API is
   * unavailable, since a single-tab browser has nothing to dedupe against.
   */
  claim(id: string): Promise<boolean>;
  /** Shows one notification; `onActivate` fires when the user clicks it. */
  show(options: { title: string; body: string; tag: string; onActivate: () => void }): void;
}

const LOCK_NAME_PREFIX = "pi-web-prompt-notify:";
const NOTIFICATION_CLICK_MESSAGE_TYPE = "pi-web:notification-click";
const NOTIFICATION_SW_URL = "notification-sw.js";

/** Narrows a service worker message's `data` to the click-relay tag it carries, if any. */
function notificationClickTag(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const type: unknown = Reflect.get(data, "type");
  const tag: unknown = Reflect.get(data, "tag");
  return type === NOTIFICATION_CLICK_MESSAGE_TYPE && typeof tag === "string" ? tag : undefined;
}

export class WindowBrowserNotificationGateway implements BrowserNotificationGateway {
  private readonly pendingActivations = new Map<string, () => void>();
  private serviceWorkerReady: Promise<ServiceWorkerRegistration | undefined> | undefined;
  private messageListenerInstalled = false;

  isSupported(): boolean {
    return typeof window !== "undefined" && "Notification" in window;
  }

  async ensurePermission(): Promise<NotificationPermission> {
    if (!this.isSupported()) return "denied";
    if (Notification.permission !== "default") return Notification.permission;
    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }

  async claim(id: string): Promise<boolean> {
    const locks = typeof navigator === "undefined" ? undefined : navigator.locks;
    if (locks === undefined) return true;
    try {
      return await locks.request(`${LOCK_NAME_PREFIX}${id}`, { ifAvailable: true }, (lock) => lock !== null);
    } catch {
      return true;
    }
  }

  show(options: { title: string; body: string; tag: string; onActivate: () => void }): void {
    if (!this.isSupported() || Notification.permission !== "granted") return;
    this.pendingActivations.set(options.tag, options.onActivate);
    this.installClickRelayOnce();
    void this.display(options);
  }

  /**
   * Shows through the service worker when one is available — required for
   * Android/mobile Chrome, which throws on the direct `Notification`
   * constructor — falling back to that constructor for browsers (mainly
   * desktop) that support it without a worker.
   */
  private async display(options: { title: string; body: string; tag: string }): Promise<void> {
    const registration = await this.readyRegistration();
    if (registration !== undefined) {
      try {
        await registration.showNotification(options.title, { body: options.body, tag: options.tag });
        return;
      } catch {
        // Fall through to the direct constructor below.
      }
    }
    try {
      const notification = new Notification(options.title, { body: options.body, tag: options.tag });
      notification.onclick = () => {
        window.focus();
        notification.close();
        this.resolveActivation(options.tag);
      };
    } catch {
      // Some browsers (notably mobile Chrome without a service worker) throw
      // synchronously here; there is nothing further to fall back to.
      this.pendingActivations.delete(options.tag);
    }
  }

  private installClickRelayOnce(): void {
    if (this.messageListenerInstalled) return;
    if (typeof navigator === "undefined") return;
    this.messageListenerInstalled = true;
    navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
      const tag = notificationClickTag(event.data);
      if (tag !== undefined) this.resolveActivation(tag);
    });
  }

  private resolveActivation(tag: string): void {
    const onActivate = this.pendingActivations.get(tag);
    this.pendingActivations.delete(tag);
    onActivate?.();
  }

  private async readyRegistration(): Promise<ServiceWorkerRegistration | undefined> {
    if (typeof navigator === "undefined") return undefined;
    this.serviceWorkerReady ??= this.registerAndAwaitReady();
    return this.serviceWorkerReady;
  }

  private async registerAndAwaitReady(): Promise<ServiceWorkerRegistration | undefined> {
    try {
      await navigator.serviceWorker.register(resolveAppUrl(NOTIFICATION_SW_URL), { scope: resolveAppUrl("") });
      return await navigator.serviceWorker.ready;
    } catch {
      return undefined;
    }
  }
}
