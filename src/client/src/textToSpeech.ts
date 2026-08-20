/**
 * Thin wrapper around the browser `speechSynthesis` API for on-demand
 * "read this message aloud" playback. Kept separate from ChatView so the
 * component doesn't touch `window.speechSynthesis` directly.
 *
 * Only one utterance plays at a time: starting a new one cancels whatever
 * was speaking.
 */

export function isTextToSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Speak `text` aloud, calling `onDone` exactly once when playback ends
 * (naturally, on error, or because it was cancelled/superseded). */
export function speak(text: string, onDone: () => void): void {
  if (!isTextToSpeechSupported() || text.trim() === "") {
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
  if (!isTextToSpeechSupported()) return;
  window.speechSynthesis.cancel();
}
