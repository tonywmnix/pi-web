import type { SessionInfo } from "./api";

export function shortSessionId(id: string): string {
  return id.slice(-8);
}

/**
 * How a session is named to a reader: its title, else the prompt that started
 * it, else a short id. Shared so a session reads the same in the list, in a
 * notification, and anywhere else it is announced.
 */
export function sessionLabel(session: SessionInfo): string {
  if (session.name !== undefined && session.name !== "") return session.name;
  return session.firstMessage !== "" ? session.firstMessage : shortSessionId(session.id);
}
