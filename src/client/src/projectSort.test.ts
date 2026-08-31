import { describe, expect, it } from "vitest";
import type { Project } from "./api";
import { isProjectSortMode, loadProjectSortMode, sortProjects, type ProjectSortStorage } from "./projectSort";

function project(name: string, createdAt: string): Project {
  return { id: name, name, path: `/repo/${name}`, createdAt };
}

const projects = [
  project("charlie", "2026-01-03T00:00:00.000Z"),
  project("Alpha", "2026-01-01T00:00:00.000Z"),
  project("bravo", "2026-06-09T00:00:00.000Z"),
];

describe("sortProjects", () => {
  it("returns a copy in the original order for the added mode", () => {
    const sorted = sortProjects(projects, "added");

    expect(sorted.map((p) => p.name)).toEqual(["charlie", "Alpha", "bravo"]);
    expect(sorted).not.toBe(projects);
  });

  it("sorts by name case-insensitively", () => {
    expect(sortProjects(projects, "name").map((p) => p.name)).toEqual(["Alpha", "bravo", "charlie"]);
  });

  it("sorts numbered names in human order rather than lexicographically", () => {
    const numbered = [project("run-10", "2026-01-01T00:00:00.000Z"), project("run-2", "2026-01-01T00:00:00.000Z")];

    expect(sortProjects(numbered, "name").map((p) => p.name)).toEqual(["run-2", "run-10"]);
  });

  it("puts the most recently added project on top", () => {
    expect(sortProjects(projects, "recent").map((p) => p.name)).toEqual(["bravo", "charlie", "Alpha"]);
  });

  it("keeps the incoming order for ties instead of reshuffling", () => {
    const sameDay = [project("second", "2026-01-01T00:00:00.000Z"), project("first", "2026-01-01T00:00:00.000Z")];

    expect(sortProjects(sameDay, "recent").map((p) => p.name)).toEqual(["second", "first"]);
  });

  it("sorts an unparseable timestamp last rather than corrupting the order", () => {
    const withBadDate = [project("broken", "not-a-date"), project("good", "2026-01-01T00:00:00.000Z")];

    expect(sortProjects(withBadDate, "recent").map((p) => p.name)).toEqual(["good", "broken"]);
  });

  it("prefers a project's known last-conversation timestamp over its createdAt for recent", () => {
    // "Alpha" was added first but has the most recent conversation of the three.
    const activity = { Alpha: "2026-12-25T00:00:00.000Z" };

    expect(sortProjects(projects, "recent", activity).map((p) => p.name)).toEqual(["Alpha", "bravo", "charlie"]);
  });

  it("falls back to createdAt for a project missing from the activity map", () => {
    const activity = { bravo: "2020-01-01T00:00:00.000Z" };

    expect(sortProjects(projects, "recent", activity).map((p) => p.name)).toEqual(["charlie", "Alpha", "bravo"]);
  });

  it("never mutates the source array", () => {
    const source = [...projects];
    sortProjects(source, "name");

    expect(source.map((p) => p.name)).toEqual(["charlie", "Alpha", "bravo"]);
  });
});

describe("sort mode persistence", () => {
  it("falls back to the added order for missing or unknown stored values", () => {
    const entries = new Map<string, string>();
    const fake: ProjectSortStorage = {
      getItem: (key) => entries.get(key) ?? null,
      setItem: (key, value) => { entries.set(key, value); },
    };

    expect(loadProjectSortMode(fake)).toBe("added");
    entries.set("pi-web:project-sort", "sideways");
    expect(loadProjectSortMode(fake)).toBe("added");
  });

  it("survives a storage that throws on access", () => {
    const hostile: ProjectSortStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
    };

    expect(loadProjectSortMode(hostile)).toBe("added");
  });

  it("recognises only the supported modes", () => {
    expect(["added", "name", "recent"].every(isProjectSortMode)).toBe(true);
    expect(isProjectSortMode("size")).toBe(false);
  });
});
