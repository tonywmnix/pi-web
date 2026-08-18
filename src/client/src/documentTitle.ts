/**
 * The browser tab as an unread indicator.
 *
 * The sidebar badge and the row highlight only reach someone looking at the
 * page. A tab switched away from shows nothing but its title, so that is where
 * a count has to go for it to be seen at all - and unlike a notification it
 * needs no permission and survives being dismissed.
 */

export const BASE_DOCUMENT_TITLE = "PI WEB";

/** Beyond this the exact number stops being useful and starts costing tab width. */
const MAX_DISPLAYED_UNREAD = 99;

/**
 * `(3) PI WEB`, or the plain title when nothing is unread.
 *
 * The count leads because a tab strip truncates from the right, and it is the
 * first few characters that survive being one of twenty open tabs.
 */
export function documentTitleWithUnread(unreadCount: number, base: string = BASE_DOCUMENT_TITLE): string {
  if (!Number.isFinite(unreadCount)) return base;
  const count = Math.floor(unreadCount);
  if (count <= 0) return base;
  return `(${count > MAX_DISPLAYED_UNREAD ? `${String(MAX_DISPLAYED_UNREAD)}+` : String(count)}) ${base}`;
}

/** The slice of `Document` this needs, so tests can supply a plain object. */
export interface DocumentTitleTarget {
  title: string;
}

/**
 * Write the title, but only when it actually changes.
 *
 * This runs on every render, and assigning `document.title` is observable:
 * browsers push a history/tab update for each write, and some session-restore
 * paths treat a rewritten title as a navigation signal.
 */
export function applyDocumentTitle(title: string, target: DocumentTitleTarget | undefined = safeDocument()): void {
  if (target === undefined) return;
  if (target.title === title) return;
  target.title = title;
}

function safeDocument(): DocumentTitleTarget | undefined {
  return typeof document === "undefined" ? undefined : document;
}
