/**
 * Thin adapter over the browser `Notification` and Web Locks APIs. Kept
 * separate from {@link PromptNotificationController} so the orchestration
 * logic can be unit-tested with a fake gateway instead of real browser
 * globals.
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

export class WindowBrowserNotificationGateway implements BrowserNotificationGateway {
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
    const notification = new Notification(options.title, { body: options.body, tag: options.tag });
    notification.onclick = () => {
      window.focus();
      notification.close();
      options.onActivate();
    };
  }
}
