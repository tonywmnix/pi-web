/**
 * Thin wrapper around text-to-speech playback for PI WEB's built-in speech
 * features (the chat message "Read aloud" button, and voice mode's spoken
 * replies). Kept separate from ChatView/PromptEditor so those components
 * don't touch `window.speechSynthesis` directly.
 *
 * By default this speaks via the browser's native `speechSynthesis` API.
 * A plugin can take over instead by contributing a `ttsProviders` entry
 * (see `plugins/types.ts`); PiWebApp resolves the active one from the
 * plugin registry and pushes it here via {@link setActiveTtsProvider} —
 * this module stays registry-agnostic, it just speaks through whichever
 * provider (if any) is currently registered.
 *
 * Only one utterance plays at a time: starting a new one cancels whatever
 * was speaking, whether that was native or provider-driven.
 */

export interface TtsProvider {
  /** Same contract as {@link speak}: call `onDone` exactly once when playback ends. */
  speak: (text: string, onDone: () => void) => void;
  stopSpeaking: () => void;
}

let activeProvider: TtsProvider | undefined;

/**
 * Registers (or, with `undefined`, clears) the plugin-provided TTS backend
 * that {@link speak}/{@link stopSpeaking} delegate to instead of the
 * browser's native `speechSynthesis`. PiWebApp calls this whenever the
 * resolved active `ttsProviders` contribution may have changed (plugin
 * load, machine switch); nothing else should call it.
 */
export function setActiveTtsProvider(provider: TtsProvider | undefined): void {
  if (provider === activeProvider) return;
  stopSpeaking(); // stops whatever the outgoing backend (native or provider) was doing
  activeProvider = provider;
}

function isNativeTextToSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function isTextToSpeechSupported(): boolean {
  return activeProvider !== undefined || isNativeTextToSpeechSupported();
}

/** Speak `text` aloud, calling `onDone` exactly once when playback ends
 * (naturally, on error, or because it was cancelled/superseded). */
export function speak(text: string, onDone: () => void): void {
  if (text.trim() === "") {
    onDone();
    return;
  }
  if (activeProvider !== undefined) {
    activeProvider.speak(text, onDone);
    return;
  }
  if (!isNativeTextToSpeechSupported()) {
    onDone();
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.addEventListener("end", onDone);
  utterance.addEventListener("error", onDone);
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (activeProvider !== undefined) {
    activeProvider.stopSpeaking();
    return;
  }
  if (!isNativeTextToSpeechSupported()) return;
  window.speechSynthesis.cancel();
}
