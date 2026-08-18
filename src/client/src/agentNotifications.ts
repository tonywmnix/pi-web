/**
 * Desktop notifications for the two moments worth interrupting someone over:
 * the agent finished, or it is blocked waiting on an answer.
 *
 * These only fire when the page is in the background. A notification for
 * something already on screen is pure noise, and the row highlight and chime
 * already cover the foreground case.
 */

const STORAGE_KEY = "pi-web:desktop-notifications";

/** The slice of `Storage` this module needs, so tests can supply a plain object. */
export interface NotificationStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type NotificationSupport = "unsupported" | "default" | "granted" | "denied";

export type AgentNotificationKind = "question" | "done";

/**
 * Off until asked for, unlike the chime.
 *
 * Turning these on requires a permission prompt, and a prompt nobody asked for
 * is the kind of thing people reflexively deny - which is unrecoverable from
 * inside the page.
 */
export function areNotificationsEnabled(storage: NotificationStorage | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

export function setNotificationsEnabled(enabled: boolean, storage: NotificationStorage | undefined = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Ignore localStorage quota/privacy errors; the choice still applies for this tab.
  }
}

export function notificationSupport(): NotificationSupport {
  if (typeof Notification === "undefined") return "unsupported";
  return Notification.permission;
}

/**
 * What to tell someone whose notifications are not on, or null once they are.
 *
 * `default` is the case worth spelling out. A browser is free to answer a
 * permission request without ever showing a prompt - Chrome's quieter UI does
 * exactly that on shared domains, resolving `default` and hiding the ask behind
 * an address-bar icon. Treating that as a plain failure leaves a button that
 * does nothing when clicked and explains nothing, which is indistinguishable
 * from a bug.
 */
export function notificationGuidance(permission: NotificationSupport): string | null {
  switch (permission) {
    case "granted":
      return null;
    case "unsupported":
      return "This browser cannot show desktop notifications.";
    case "denied":
      return "Notifications are blocked for this site. Allow them in the address-bar site settings, then click again.";
    case "default":
      return "The browser did not show a permission prompt. Look for a notifications icon in the address bar, choose Allow, then click again.";
  }
}

/** Ask the browser for permission. Must be called from a user gesture. */
export async function requestNotificationPermission(): Promise<NotificationSupport> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Everything the decision depends on, gathered so the rule itself stays pure. */
export interface NotificationGate {
  enabled: boolean;
  permission: NotificationSupport;
  /** True when the page is visible *and* focused. */
  foreground: boolean;
}

export function shouldShowNotification(gate: NotificationGate): boolean {
  if (!gate.enabled) return false;
  if (gate.permission !== "granted") return false;
  return !gate.foreground;
}

/** Visible and focused. Anything else - hidden tab, other window - is background. */
export function isPageInForeground(): boolean {
  if (typeof document === "undefined") return false;
  if (document.visibilityState !== "visible") return false;
  if (typeof document.hasFocus === "function") return document.hasFocus();
  return true;
}

export interface AgentNotificationInput {
  kind: AgentNotificationKind;
  sessionId: string;
  sessionLabel: string;
}

/**
 * Show a notification, or do nothing.
 *
 * Silent on every failure path for the same reason the chime is: this runs
 * inside a status or activity update, and a browser that refuses to construct a
 * notification must not break the update that triggered it.
 */
export function showAgentNotification(input: AgentNotificationInput): boolean {
  const gate: NotificationGate = {
    enabled: areNotificationsEnabled(),
    permission: notificationSupport(),
    foreground: isPageInForeground(),
  };
  if (!shouldShowNotification(gate)) return false;
  try {
    const notification = new Notification(notificationTitle(input.kind), {
      body: input.sessionLabel,
      // Tagged per session and kind so a session that finishes twice replaces
      // its own notification instead of stacking a column of them.
      tag: `pi-web:${input.kind}:${input.sessionId}`,
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // Focusing is a courtesy; a browser that refuses still closes the notification.
      }
      notification.close();
    };
    return true;
  } catch {
    return false;
  }
}

export function notificationTitle(kind: AgentNotificationKind): string {
  return kind === "question" ? "Waiting for your answer" : "Agent finished";
}

function safeStorage(): NotificationStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
