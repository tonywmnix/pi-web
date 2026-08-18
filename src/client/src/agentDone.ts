import type { SessionActivity } from "./api";

/**
 * Whether this activity means the agent is doing work.
 *
 * Startup reports are published as `active` because starting a session really
 * is in progress, but starting a session is not *working* in it. Counting them
 * would announce that the agent had "finished" every time a session finished
 * opening.
 */
export function activityIsWorking(activity: SessionActivity): boolean {
  return activity.phase === "active" && activity.startup !== true;
}

/**
 * Decides which activity updates mean a session just finished working.
 *
 * Only a working -> not-working transition counts, which also makes this
 * naturally quiet on load: a session first seen idle has no recorded working
 * state to fall from, so a page refresh cannot announce work that finished
 * before the browser was even open.
 *
 * `error` counts as finished. The agent has stopped either way, and a run that
 * ended badly is if anything more worth surfacing than one that ended well.
 */
export class SessionDoneTracker {
  private readonly workingBySessionId = new Map<string, boolean>();

  /** True when this update is a fresh transition out of working. */
  observe(activity: SessionActivity): boolean {
    const working = activityIsWorking(activity);
    const wasWorking = this.workingBySessionId.get(activity.sessionId);
    this.workingBySessionId.set(activity.sessionId, working);
    return wasWorking === true && !working;
  }

  /** Drop a session so a later re-appearance is treated as a first sighting. */
  forget(sessionId: string): void {
    this.workingBySessionId.delete(sessionId);
  }
}
