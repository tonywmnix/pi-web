/**
 * The audible half of the waiting-for-an-answer signal.
 *
 * The chime is synthesised through Web Audio rather than shipped as an audio
 * file: it keeps a binary asset out of the bundle, needs no second network
 * request at the moment it has to be prompt, and works offline.
 *
 * Muting is per browser, not per project, because whether a sound is welcome
 * depends on the device it would come out of.
 */

const STORAGE_KEY = "pi-web:ask-sound";

/** The slice of `Storage` this module needs, so tests can supply a plain object. */
export interface AskSoundStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Sounds are on unless explicitly turned off, so the signal is not silently missed. */
export function isAskSoundEnabled(storage: AskSoundStorage | undefined = safeStorage()): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAskSoundEnabled(enabled: boolean, storage: AskSoundStorage | undefined = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Ignore localStorage quota/privacy errors; the choice still applies in memory for this tab.
  }
}

/** Two rising notes: distinct from an error buzz, short enough not to be a nuisance. */
const NOTES: readonly { hertz: number; startsAt: number; seconds: number }[] = [
  { hertz: 880, startsAt: 0, seconds: 0.12 },
  { hertz: 1174.66, startsAt: 0.13, seconds: 0.18 },
];

const PEAK_GAIN = 0.07;

let sharedContext: AudioContext | undefined;

/**
 * Play the attention chime, or do nothing at all.
 *
 * Every failure path is silent by design: no Web Audio (tests, old browsers),
 * a context the browser refuses to start, or an autoplay policy that keeps it
 * suspended until the page has been interacted with. A notification sound is
 * not worth surfacing an error over, and the visual signal always stands alone.
 */
export function playAskChime(): void {
  if (!isAskSoundEnabled()) return;
  const context = ensureContext();
  if (context === undefined) return;
  try {
    // Autoplay policy parks the context until the page has been interacted with.
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    const startedAt = context.currentTime;
    for (const note of NOTES) emitNote(context, note, startedAt);
  } catch {
    // A browser that rejects node creation stays silent rather than throwing
    // into whatever status update happened to trigger this.
  }
}

function emitNote(context: AudioContext, note: { hertz: number; startsAt: number; seconds: number }, startedAt: number): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.value = note.hertz;

  // Ramped rather than switched: an instant gain change clicks audibly.
  const begins = startedAt + note.startsAt;
  const ends = begins + note.seconds;
  gain.gain.setValueAtTime(0, begins);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, begins + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, ends);

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(begins);
  oscillator.stop(ends + 0.02);
}

function ensureContext(): AudioContext | undefined {
  if (sharedContext !== undefined) return sharedContext;
  if (typeof AudioContext === "undefined") return undefined;
  try {
    sharedContext = new AudioContext();
    return sharedContext;
  } catch {
    return undefined;
  }
}

function safeStorage(): AskSoundStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
