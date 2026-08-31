import type { Project } from "./api";

/** `added` preserves the order projects were registered in, which is what PI WEB showed before sorting existed. */
export type ProjectSortMode = "added" | "name" | "recent";

export const PROJECT_SORT_MODES: readonly ProjectSortMode[] = ["added", "name", "recent"];

const PROJECT_SORT_LABELS: Record<ProjectSortMode, string> = {
  added: "Added order",
  name: "Name (A–Z)",
  recent: "Recent first",
};

const STORAGE_KEY = "pi-web:project-sort";

/** The slice of `Storage` this module needs, so tests can supply a plain object. */
export interface ProjectSortStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function projectSortLabel(mode: ProjectSortMode): string {
  return PROJECT_SORT_LABELS[mode];
}

export function isProjectSortMode(value: unknown): value is ProjectSortMode {
  return PROJECT_SORT_MODES.some((mode) => mode === value);
}

/** Project id → timestamp of that project's most recent session activity, when known. */
export type ProjectActivity = Readonly<Record<string, string>>;

/**
 * Returns a sorted copy; the input order is preserved for `added` and used as the
 * tie-breaker elsewhere so equal keys never reshuffle between renders.
 *
 * `activity` drives `recent`: a project with a known last-conversation timestamp
 * sorts by that instead of by when it was registered, so "recent" tracks actual
 * usage rather than add order. A project missing from `activity` (not yet
 * fetched, or no sessions at all) falls back to its `createdAt`.
 */
export function sortProjects(projects: readonly Project[], mode: ProjectSortMode, activity: ProjectActivity = {}): Project[] {
  if (mode === "added") return [...projects];
  const indexed = projects.map((project, index) => ({ project, index }));
  indexed.sort((a, b) => compare(a.project, b.project, mode, activity) || a.index - b.index);
  return indexed.map((entry) => entry.project);
}

function compare(a: Project, b: Project, mode: Exclude<ProjectSortMode, "added">, activity: ProjectActivity): number {
  if (mode === "name") return a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });
  return recencyValue(b, activity) - recencyValue(a, activity);
}

/** Unparseable or missing timestamps sort last rather than poisoning the comparison with NaN. */
function recencyValue(project: Project, activity: ProjectActivity): number {
  const raw = activity[project.id] ?? project.createdAt;
  const value = Date.parse(raw);
  return Number.isNaN(value) ? Number.NEGATIVE_INFINITY : value;
}

export function loadProjectSortMode(storage: ProjectSortStorage | undefined = safeStorage()): ProjectSortMode {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return isProjectSortMode(raw) ? raw : "added";
  } catch {
    return "added";
  }
}

export function saveProjectSortMode(mode: ProjectSortMode, storage: ProjectSortStorage | undefined = safeStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch {
    // Ignore localStorage quota/privacy errors; the chosen order still applies in memory for this tab.
  }
}

function safeStorage(): ProjectSortStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
