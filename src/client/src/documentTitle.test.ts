import { describe, expect, it } from "vitest";
import { applyDocumentTitle, BASE_DOCUMENT_TITLE, documentTitleWithUnread, type DocumentTitleTarget } from "./documentTitle";

describe("documentTitleWithUnread", () => {
  it("leads with the count so it survives tab truncation", () => {
    expect(documentTitleWithUnread(3)).toBe("(3) PI WEB");
  });

  it("shows the plain title when nothing is unread", () => {
    expect(documentTitleWithUnread(0)).toBe(BASE_DOCUMENT_TITLE);
  });

  it("treats a negative or non-finite count as nothing unread", () => {
    // A count is derived from a set size, but the title must not render
    // "(-1)" or "(NaN)" if that ever stops being true.
    expect(documentTitleWithUnread(-1)).toBe(BASE_DOCUMENT_TITLE);
    expect(documentTitleWithUnread(Number.NaN)).toBe(BASE_DOCUMENT_TITLE);
    expect(documentTitleWithUnread(Number.POSITIVE_INFINITY)).toBe(BASE_DOCUMENT_TITLE);
  });

  it("caps the displayed count rather than widening the tab", () => {
    expect(documentTitleWithUnread(99)).toBe("(99) PI WEB");
    expect(documentTitleWithUnread(100)).toBe("(99+) PI WEB");
  });

  it("accepts a different base title", () => {
    expect(documentTitleWithUnread(2, "Sessions")).toBe("(2) Sessions");
  });
});

describe("applyDocumentTitle", () => {
  it("writes the title when it differs", () => {
    const target: DocumentTitleTarget = { title: "PI WEB" };

    applyDocumentTitle("(1) PI WEB", target);

    expect(target.title).toBe("(1) PI WEB");
  });

  it("does not rewrite an unchanged title", () => {
    // This runs on every render; a redundant assignment is a real browser-side
    // event, not a no-op.
    let writes = 0;
    const target: DocumentTitleTarget = {
      get title() { return "(1) PI WEB"; },
      set title(_value: string) { writes += 1; },
    };

    applyDocumentTitle("(1) PI WEB", target);
    expect(writes).toBe(0);

    applyDocumentTitle("(2) PI WEB", target);
    expect(writes).toBe(1);
  });

  it("does nothing where there is no document", () => {
    expect(typeof document).toBe("undefined");
    expect(() => { applyDocumentTitle("(1) PI WEB"); }).not.toThrow();
  });
});
