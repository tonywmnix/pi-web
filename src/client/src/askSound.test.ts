import { describe, expect, it } from "vitest";
import { isAskSoundEnabled, playAskChime, setAskSoundEnabled, type AskSoundStorage } from "./askSound";

function memoryStorage(initial: Record<string, string> = {}): AskSoundStorage {
  const entries = new Map(Object.entries(initial));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
  };
}

describe("ask sound preference", () => {
  it("is on by default, so the alert is not silently missed", () => {
    expect(isAskSoundEnabled(memoryStorage())).toBe(true);
  });

  it("round-trips through storage", () => {
    const storage = memoryStorage();

    setAskSoundEnabled(false, storage);
    expect(isAskSoundEnabled(storage)).toBe(false);

    setAskSoundEnabled(true, storage);
    expect(isAskSoundEnabled(storage)).toBe(true);
  });

  it("treats only an explicit off as muted", () => {
    expect(isAskSoundEnabled(memoryStorage({ "pi-web:ask-sound": "off" }))).toBe(false);
    expect(isAskSoundEnabled(memoryStorage({ "pi-web:ask-sound": "on" }))).toBe(true);
    // An unrecognised value falls back to audible rather than silently muting.
    expect(isAskSoundEnabled(memoryStorage({ "pi-web:ask-sound": "banana" }))).toBe(true);
  });

  it("stays audible when storage throws on read", () => {
    const hostile: AskSoundStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };

    expect(isAskSoundEnabled(hostile)).toBe(true);
    expect(() => { setAskSoundEnabled(false, hostile); }).not.toThrow();
  });
});

describe("playAskChime", () => {
  it("is a no-op rather than a crash where Web Audio does not exist", () => {
    // Vitest runs without Web Audio, which is the same shape as an old browser
    // or a locked-down context: the visual signal stands alone and nothing
    // throws into the status update that triggered this.
    expect(typeof AudioContext).toBe("undefined");
    expect(() => { playAskChime(); }).not.toThrow();
  });
});
