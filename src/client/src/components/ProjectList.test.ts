// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { Project } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { machineStatusSnapshot } from "../machineStatus.testSupport";
import { ProjectList } from "./ProjectList";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("project status indicator", () => {
  it("shows an unread dot only on projects the snapshot reports as unread", async () => {
    const list = await mountProjectList(
      [project("project-a"), project("project-b")],
      machineStatusSnapshot({ projects: { "project-b": { "core:unread": true } } }),
    );

    expect(unreadDot(rowFor(list, "project-a"))).toBeNull();
    const dot = unreadDot(rowFor(list, "project-b"));
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute("title")).toBe("Unread sessions in this project");
  });

  it("clears the dot once a newer snapshot reports nothing unread", async () => {
    const list = await mountProjectList([project("project-a")], machineStatusSnapshot({ projects: { "project-a": { "core:unread": true } } }));
    expect(list.shadowRoot?.querySelector(".activity-indicator.unread")).not.toBeNull();

    list.statusSnapshot = machineStatusSnapshot({ revision: 2 });
    await list.updateComplete;

    expect(list.shadowRoot?.querySelector(".activity-indicator.unread")).toBeNull();
  });

  it("wraps the work dot in an unread ring when the project is busy and unread", async () => {
    const list = await mountProjectList(
      [project("project-a")],
      machineStatusSnapshot({ projects: { "project-a": { "core:working": true, "core:unread": true } } }),
    );

    const row = rowFor(list, "project-a");
    const ring = row.querySelector(".unread-ring");
    expect(ring?.querySelector(".activity-indicator.session")).not.toBeNull();
    expect(ring?.getAttribute("title")).toBe("Unread sessions in this project · Project active");
    expect(row.querySelector(".activity-indicator.unread")).toBeNull();
  });

  it("lights a project whose workspaces have never been opened, for work and for unread", async () => {
    // The row reads the server-attributed snapshot, so it no longer depends on
    // the browser having loaded that project's workspaces.
    const list = await mountProjectList(
      [project("unvisited-work"), project("unvisited-unread")],
      machineStatusSnapshot({
        projects: { "unvisited-work": { "core:working": true }, "unvisited-unread": { "core:unread": true } },
      }),
    );

    expect(rowFor(list, "unvisited-work").querySelector(".activity-indicator.session")).not.toBeNull();
    expect(unreadDot(rowFor(list, "unvisited-unread"))).not.toBeNull();
  });

  it("flags a project whose session is waiting on an answer, and outranks work", async () => {
    const list = await mountProjectList(
      [project("waiting"), project("busy")],
      machineStatusSnapshot({
        projects: {
          // Waiting and working at once: the ask must win the single mark.
          waiting: { "core:ask": true, "core:working": true },
          busy: { "core:working": true },
        },
      }),
    );

    const waiting = rowFor(list, "waiting");
    expect(waiting.classList.contains("awaiting-answer")).toBe(true);
    expect(waiting.querySelector(".activity-indicator.ask")).not.toBeNull();
    expect(waiting.querySelector(".activity-indicator.session")).toBeNull();
    expect(waiting.querySelector(".action-activity [title]")?.getAttribute("title")).toBe("Waiting for your answer");
    expect(waiting.getAttribute("title")).toContain("waiting for your answer");

    const busy = rowFor(list, "busy");
    expect(busy.classList.contains("awaiting-answer")).toBe(false);
    expect(busy.querySelector(".activity-indicator.session")).not.toBeNull();
  });

  it("tints the whole waiting row, overriding the project's own colour", async () => {
    const list = await mountProjectList(
      [{ ...project("waiting"), color: "#30a46c" }],
      machineStatusSnapshot({ projects: { waiting: { "core:ask": true } } }),
    );

    const row = rowFor(list, "waiting");
    // Both classes coexist; CSS precedence decides which colour paints.
    expect(row.classList.contains("tinted")).toBe(true);
    expect(row.classList.contains("awaiting-answer")).toBe(true);

    const rules = [...(list.shadowRoot?.adoptedStyleSheets ?? [])].flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText));
    const askOverride = rules.findIndex((rule) => rule.startsWith(".action-row.tinted.awaiting-answer .action-main"));
    const colourRule = rules.findIndex((rule) => rule.startsWith(".action-row.tinted .action-main"));

    expect(askOverride).toBeGreaterThan(-1);
    // One extra class and declared later: it wins on both counts.
    expect(askOverride).toBeGreaterThan(colourRule);
    expect(rules[askOverride]).toContain("--pi-warning");
    // The background declaration itself is not asserted: happy-dom's CSS parser
    // drops color-mix() values, so the rule body it exposes omits them. Ordering,
    // specificity, and the warning hue are what this test can actually prove.
  });

  it("covers the menu button too, so the whole pill reads as waiting", async () => {
    const list = await mountProjectList([project("waiting")], machineStatusSnapshot({ projects: { waiting: { "core:ask": true } } }));
    const rules = [...(list.shadowRoot?.adoptedStyleSheets ?? [])].flatMap((sheet) => [...sheet.cssRules].map((rule) => rule.cssText));

    const baseRule = rules.find((rule) => rule.startsWith(".action-row.awaiting-answer .action-main"));
    expect(baseRule).toContain(".action-row.awaiting-answer .action-menu-toggle");
  });

  it("drops the waiting flag once the snapshot reports the question answered", async () => {
    const list = await mountProjectList([project("waiting")], machineStatusSnapshot({ projects: { waiting: { "core:ask": true } } }));
    expect(rowFor(list, "waiting").classList.contains("awaiting-answer")).toBe(true);

    list.statusSnapshot = machineStatusSnapshot({ revision: 2 });
    await list.updateComplete;

    expect(rowFor(list, "waiting").classList.contains("awaiting-answer")).toBe(false);
    expect(list.shadowRoot?.querySelector(".activity-indicator.ask")).toBeNull();
  });

  it("shows no indicator when the machine publishes no snapshot", async () => {
    const list = await mountProjectList([project("project-a")], undefined);

    expect(rowFor(list, "project-a").querySelector(".activity-indicator")).toBeNull();
  });

  it("still lights a row from a flag id this build does not know", async () => {
    const list = await mountProjectList([project("project-a")], machineStatusSnapshot({ projects: { "project-a": { "core:future": true } } }));

    expect(rowFor(list, "project-a").querySelector(".activity-indicator.session")).not.toBeNull();
  });
});

describe("project color", () => {
  it("marks only the coloured row and exposes the colour as a CSS custom property", async () => {
    const list = await mountProjectList([{ ...project("plain") }, { ...project("tinted"), color: "#30a46c" }], undefined);

    expect(rowFor(list, "plain").classList.contains("tinted")).toBe(false);
    expect(rowFor(list, "plain").getAttribute("style")).toBe("");
    const tinted = rowFor(list, "tinted");
    expect(tinted.classList.contains("tinted")).toBe(true);
    expect(tinted.getAttribute("style")).toContain("--pi-project-color: #30a46c");
  });

  it("tints the whole row pill, both the label side and the menu button", async () => {
    const list = await mountProjectList([{ ...project("tinted"), color: "#30a46c" }], undefined);
    const sheet = [...(list.shadowRoot?.adoptedStyleSheets ?? [])].flatMap((style) => [...style.cssRules].map((rule) => rule.cssText));
    const tintRule = sheet.find((rule) => rule.startsWith(".action-row.tinted .action-main"));

    // The menu button shares the rule so the colour covers the pill, not just the label half.
    expect(tintRule).toContain(".action-row.tinted .action-menu-toggle");
    expect(tintRule).toContain("var(--pi-project-tint)");

    const style = rowFor(list, "tinted").getAttribute("style") ?? "";
    expect(style).toContain("--pi-project-tint: rgba(48, 164, 108, 0.22)");
    expect(style).toContain("--pi-project-tint-hover: rgba(48, 164, 108, 0.34)");
    expect(style).toContain("--pi-project-tint-selected: rgba(48, 164, 108, 0.45)");
  });

  it("names the current colour on the menu entry", async () => {
    const list = await mountProjectList([{ ...project("project-a"), color: "#30a46c" }], undefined);

    rowFor(list, "project-a").querySelector<HTMLButtonElement>(".action-menu-toggle")?.click();
    await list.updateComplete;

    expect(menuButton(list, "Color")?.textContent).toContain("Color · Green");
  });

  it("gives every swatch a visible background that the menu's button reset cannot erase", async () => {
    const list = await mountProjectList([project("project-a")], undefined);
    await openColorPicker(list, "project-a");

    const swatches = [...(list.shadowRoot?.querySelectorAll<HTMLElement>(".project-color-swatch") ?? [])];
    expect(swatches).toHaveLength(10);
    for (const swatch of swatches) {
      // The inline custom property is what the stylesheet paints, so it must survive on every swatch.
      expect(swatch.getAttribute("style")).toMatch(/--pi-swatch: #[0-9a-f]{6}/i);
    }

    const sheet = [...(list.shadowRoot?.adoptedStyleSheets ?? [])].flatMap((style) => [...style.cssRules].map((rule) => rule.cssText));
    const swatchRule = sheet.find((rule) => rule.startsWith(".action-menu-panel .project-color-swatch"));
    expect(swatchRule).toContain("var(--pi-swatch)");
  });

  it("reports the picked swatch through onSetColor and closes the menu", async () => {
    const chosen: (string | undefined)[] = [];
    const list = await mountProjectList([project("project-a")], undefined);
    list.onSetColor = (_project, color) => { chosen.push(color); };

    await openColorPicker(list, "project-a");
    const swatch = list.shadowRoot?.querySelector<HTMLButtonElement>(".project-color-swatch[aria-label='Blue']");
    swatch?.click();
    await list.updateComplete;

    expect(chosen).toEqual(["#0091ff"]);
    expect(list.shadowRoot?.querySelector(".action-menu-panel")).toBeNull();
  });

  it("offers a clear action only once a colour is set", async () => {
    const cleared: (string | undefined)[] = [];
    const list = await mountProjectList([{ ...project("project-a"), color: "#0091ff" }], undefined);
    list.onSetColor = (_project, color) => { cleared.push(color); };

    await openColorPicker(list, "project-a");
    list.shadowRoot?.querySelector<HTMLButtonElement>(".project-color-clear")?.click();
    await list.updateComplete;

    expect(cleared).toEqual([undefined]);
  });

  it("has no clear action while the project uses the default colour", async () => {
    const list = await mountProjectList([project("project-a")], undefined);

    await openColorPicker(list, "project-a");

    expect(list.shadowRoot?.querySelector(".project-color-clear")).toBeNull();
  });
});

describe("project sorting", () => {
  const unsorted = [
    { ...project("charlie"), createdAt: "2026-01-03T00:00:00.000Z" },
    { ...project("alpha"), createdAt: "2026-01-01T00:00:00.000Z" },
    { ...project("bravo"), createdAt: "2026-06-09T00:00:00.000Z" },
  ];

  it("keeps the added order until a sort is chosen", async () => {
    const list = await mountProjectList(unsorted, undefined);

    expect(rowNames(list)).toEqual(["charlie", "alpha", "bravo"]);
  });

  it("sorts by name and by most recent without mutating the source array", async () => {
    const projects = [...unsorted];
    const list = await mountProjectList(projects, undefined);

    await chooseSort(list, "Name (A–Z)");
    expect(rowNames(list)).toEqual(["alpha", "bravo", "charlie"]);

    await chooseSort(list, "Recent first");
    expect(rowNames(list)).toEqual(["bravo", "charlie", "alpha"]);

    expect(projects.map((entry) => entry.name)).toEqual(["charlie", "alpha", "bravo"]);
  });

  it("restores the chosen sort on a freshly mounted list", async () => {
    const first = await mountProjectList(unsorted, undefined);
    await chooseSort(first, "Recent first");

    const second = await mountProjectList(unsorted, undefined);

    expect(rowNames(second)).toEqual(["bravo", "charlie", "alpha"]);
  });
});

async function openColorPicker(list: ProjectList, projectName: string): Promise<void> {
  rowFor(list, projectName).querySelector<HTMLButtonElement>(".action-menu-toggle")?.click();
  await list.updateComplete;
  menuButton(list, "Color")?.click();
  await list.updateComplete;
}

async function chooseSort(list: ProjectList, label: string): Promise<void> {
  list.shadowRoot?.querySelector<HTMLButtonElement>(".project-sort-toggle")?.click();
  await list.updateComplete;
  menuButton(list, label)?.click();
  await list.updateComplete;
}

function menuButton(list: ProjectList, label: string): HTMLButtonElement | undefined {
  const buttons = [...(list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".action-menu-panel button") ?? [])];
  return buttons.find((button) => button.textContent.includes(label));
}

function rowNames(list: ProjectList): string[] {
  return [...(list.shadowRoot?.querySelectorAll(".workspace-primary-label") ?? [])].map((node) => node.textContent.trim());
}

async function mountProjectList(projects: Project[], statusSnapshot: MachineStatusSnapshot | undefined): Promise<ProjectList> {
  const list = new ProjectList();
  list.projects = projects;
  list.statusSnapshot = statusSnapshot;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function rowFor(list: ProjectList, projectName: string): Element {
  const rows = [...(list.shadowRoot?.querySelectorAll(".action-row") ?? [])];
  const row = rows.find((candidate) => candidate.textContent.includes(projectName));
  if (row === undefined) throw new Error(`Expected a project row for ${projectName}`);
  return row;
}

function unreadDot(row: Element): Element | null {
  return row.querySelector(".activity-indicator.unread");
}

function project(id: string): Project {
  return { id, name: id, path: `/repo/${id}`, createdAt: "2026-06-04T00:00:00.000Z" };
}
