import { describe, expect, it } from "vitest";
import {
  areNotificationsEnabled,
  isPageInForeground,
  notificationTitle,
  setNotificationsEnabled,
  shouldShowNotification,
  type NotificationStorage,
} from "./agentNotifications";

function memoryStorage(initial: Record<string, string> = {}): NotificationStorage {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
  };
}

describe("notification preference", () => {
  it("is off until explicitly enabled", () => {
    // Enabling prompts for permission, and an unprompted request tends to get
    // denied permanently, so this cannot default on.
    expect(areNotificationsEnabled(memoryStorage())).toBe(false);
  });

  it("round-trips through storage", () => {
    const storage = memoryStorage();

    setNotificationsEnabled(true, storage);
    expect(areNotificationsEnabled(storage)).toBe(true);

    setNotificationsEnabled(false, storage);
    expect(areNotificationsEnabled(storage)).toBe(false);
  });

  it("treats an unrecognised value as off", () => {
    expect(areNotificationsEnabled(memoryStorage({ "pi-web:desktop-notifications": "banana" }))).toBe(false);
  });

  it("stays off when storage throws", () => {
    const hostile: NotificationStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };

    expect(areNotificationsEnabled(hostile)).toBe(false);
    expect(() => { setNotificationsEnabled(true, hostile); }).not.toThrow();
  });
});

describe("shouldShowNotification", () => {
  it("shows only when enabled, granted, and the page is in the background", () => {
    expect(shouldShowNotification({ enabled: true, permission: "granted", foreground: false })).toBe(true);
  });

  it("stays silent while the page is in the foreground", () => {
    // The row highlight and the chime already cover what is on screen.
    expect(shouldShowNotification({ enabled: true, permission: "granted", foreground: true })).toBe(false);
  });

  it("stays silent when the preference is off", () => {
    expect(shouldShowNotification({ enabled: false, permission: "granted", foreground: false })).toBe(false);
  });

  it("stays silent without permission", () => {
    for (const permission of ["default", "denied", "unsupported"] as const) {
      expect(shouldShowNotification({ enabled: true, permission, foreground: false })).toBe(false);
    }
  });
});

describe("isPageInForeground", () => {
  it("reports background where there is no document at all", () => {
    // Node has no document; a notification cannot be raised there anyway, and
    // reporting foreground would be the more dangerous default.
    expect(typeof document).toBe("undefined");
    expect(isPageInForeground()).toBe(false);
  });
});

describe("notificationTitle", () => {
  it("distinguishes a question from a finished run", () => {
    expect(notificationTitle("question")).toBe("Waiting for your answer");
    expect(notificationTitle("done")).toBe("Agent finished");
  });
});
