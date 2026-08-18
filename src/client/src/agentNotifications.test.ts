import { describe, expect, it } from "vitest";
import {
  areNotificationsEnabled,
  isPageInForeground,
  machineNotificationLabel,
  notificationBody,
  notificationGuidance,
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

describe("notificationBody", () => {
  const base = { kind: "done", sessionId: "s1", sessionLabel: "Fix the parser" } as const;

  it("leads with the machine so it survives truncation", () => {
    expect(notificationBody({ ...base, machineLabel: "build-box" })).toBe("build-box \u00B7 Fix the parser");
  });

  it("falls back to the session alone when no machine is known", () => {
    expect(notificationBody(base)).toBe("Fix the parser");
    expect(notificationBody({ ...base, machineLabel: "   " })).toBe("Fix the parser");
  });
});

describe("machineNotificationLabel", () => {
  it("prefers the reported host over the display name", () => {
    // "Local" is what the gateway calls itself, which is exactly the case a
    // notification cannot afford to be vague about.
    expect(machineNotificationLabel({ name: "Local", hostname: "workstation" })).toBe("workstation");
  });

  it("uses the chosen name for a remote that reports no host", () => {
    expect(machineNotificationLabel({ name: "Build box" })).toBe("Build box");
    expect(machineNotificationLabel({ name: "Spare", hostname: "  " })).toBe("Spare");
  });

  it("names nothing when there is no machine", () => {
    expect(machineNotificationLabel(undefined)).toBeUndefined();
  });
});

describe("notificationGuidance", () => {
  it("says nothing once permission is granted", () => {
    expect(notificationGuidance("granted")).toBeNull();
  });

  it("explains a request the browser answered without prompting", () => {
    // The reported bug: a quieter-UI browser resolves `default` with no prompt
    // on screen, so the toggle stays off and nothing explains why.
    expect(notificationGuidance("default")).toContain("address bar");
  });

  it("points a blocked site at the setting that can undo it", () => {
    expect(notificationGuidance("denied")).toContain("blocked");
  });

  it("explains a browser that cannot notify at all", () => {
    expect(notificationGuidance("unsupported")).toContain("cannot");
  });

  it("gives every non-granted state something to show", () => {
    for (const permission of ["default", "denied", "unsupported"] as const) {
      expect(notificationGuidance(permission)).not.toBe("");
      expect(notificationGuidance(permission)).not.toBeNull();
    }
  });
});
