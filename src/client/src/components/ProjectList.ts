import { LitElement, css, html, type PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { Project } from "../api";
import type { MachineStatusSnapshot } from "../../../shared/machineStatus";
import { actionMenuPanelStyle } from "./actionMenu";
import { hasStatusAsk, hasStatusUnread, renderActionActivityIndicator, statusActivityKind, type ActivityIndicatorKind } from "./activityBadge";
import type { KeyboardNavigableSection } from "./navigationFocus";
import { activateSelectableRow, focusSelectedOrFirstSelectableRow, handleSelectableRowKeyboard } from "./selectableRow";
import { listStyles } from "./shared";
import { PROJECT_COLORS, normalizeProjectColor, projectColorName, projectTintStyle } from "../projectColors";
import { PROJECT_SORT_MODES, loadProjectSortMode, projectSortLabel, saveProjectSortMode, sortProjects, type ProjectActivity, type ProjectSortMode } from "../projectSort";

@customElement("project-list")
export class ProjectList extends LitElement implements KeyboardNavigableSection {
  @property({ attribute: false }) projects: Project[] = [];
  /** Project id → last-conversation timestamp, backing the `recent` sort mode. */
  @property({ attribute: false }) activity: ProjectActivity = {};
  @property({ attribute: false }) selected?: Project;
  /** Status tree of the machine these projects belong to; absent means no indicators. */
  @property({ attribute: false }) statusSnapshot: MachineStatusSnapshot | undefined;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) collapsed = false;
  @property({ attribute: false }) onSelect?: (project: Project) => void;
  @property({ attribute: false }) onClose?: (project: Project) => void;
  @property({ attribute: false }) onSetColor?: (project: Project, color: string | undefined) => void;
  @property({ attribute: false }) onToggleCollapsed?: () => void;
  @property({ attribute: false }) onFocusPreviousSection?: () => void | Promise<void>;
  @property({ attribute: false }) onFocusNextSection?: () => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;
  @state() private openMenuProjectId: string | undefined;
  @state() private menuStyle = "";
  /** Set while the colour picker is expanded inside the row's action menu. */
  @state() private colorMenuProjectId: string | undefined;
  @state() private sortMenuOpen = false;
  @state() private sortMenuStyle = "";
  @state() private sortMode: ProjectSortMode = loadProjectSortMode();
  private readonly onDocumentClick = (event: MouseEvent) => {
    if (event.composedPath().includes(this)) return;
    this.closeMenus();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("click", this.onDocumentClick);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("click", this.onDocumentClick);
    super.disconnectedCallback();
  }

  protected override updated(changed: PropertyValues<this>): void {
    if (changed.has("projects") && this.openMenuProjectId !== undefined && !this.projects.some((project) => project.id === this.openMenuProjectId)) {
      this.openMenuProjectId = undefined;
      this.colorMenuProjectId = undefined;
    }
    if (changed.has("collapsed") && this.collapsed) this.closeMenus();
  }

  private closeMenus(): void {
    this.openMenuProjectId = undefined;
    this.colorMenuProjectId = undefined;
    this.sortMenuOpen = false;
  }

  /** Projects in the order the user asked for; the source array is never mutated. */
  private get sortedProjects(): Project[] {
    return sortProjects(this.projects, this.sortMode, this.activity);
  }

  async focusSelectedOrFirst(): Promise<boolean> {
    await this.updateComplete;
    return focusSelectedOrFirstSelectableRow(this.renderRoot, { fallbackSelector: ".section-toggle" });
  }

  override render() {
    return html`
      <section>
        <h2 class="project-heading">${this.renderHeading()}${this.renderSortControl()}</h2>
        ${this.collapsed ? null : html`
          <div class="list-body">
            ${this.sortedProjects.map((project) => html`
              <div
                class=${`action-row ${this.selected?.id === project.id ? "selected" : ""}${project.color === undefined ? "" : " tinted"}${this.isAwaitingAnswer(project) ? " awaiting-answer" : ""}`}
                style=${projectTintStyle(project.color)}
                tabindex="0"
                title=${this.isAwaitingAnswer(project) ? `${project.path} — waiting for your answer` : project.path}
                @click=${(event: MouseEvent) => { activateSelectableRow(event, () => this.onSelect?.(project)); }}
                @keydown=${(event: KeyboardEvent) => { this.handleProjectKeydown(event, project); }}
              >
                <div class="action-main">
                  <span class="workspace-primary"><span class="workspace-primary-label">${project.name}</span></span><small>${project.path}</small>
                  ${this.renderActivity(project)}
                </div>
                <div class="action-menu">
                  <button class="action-menu-toggle" title="Project actions" aria-label=${`Actions for ${project.name}`} @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleMenu(project.id, event.currentTarget); }}>⋯</button>
                  ${this.openMenuProjectId === project.id ? html`
                    <div class="action-menu-panel" style=${this.menuStyle} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
                      <button title="Change project color" aria-expanded=${String(this.colorMenuProjectId === project.id)} @click=${() => { this.toggleColorMenu(project.id); }}>${this.colorMenuLabel(project)} ${this.colorMenuProjectId === project.id ? "▾" : "▸"}</button>
                      ${this.colorMenuProjectId === project.id ? this.renderColorPicker(project) : null}
                      <button title="Close project" @click=${() => { this.close(project); }}>Close</button>
                    </div>
                  ` : null}
                </div>
              </div>
            `)}
          </div>
        `}
      </section>
    `;
  }

  private handleProjectKeydown(event: KeyboardEvent, project: Project): void {
    handleSelectableRowKeyboard(event, {
      activate: () => this.onSelect?.(project),
      previousSection: this.onFocusPreviousSection === undefined ? undefined : () => { void this.onFocusPreviousSection?.(); },
      nextSection: this.onFocusNextSection === undefined ? undefined : () => { void this.onFocusNextSection?.(); },
      cancel: this.onCancelKeyboardNavigation === undefined ? undefined : () => { void this.onCancelKeyboardNavigation?.(); },
    });
  }

  /** Names the current colour in the menu so the row's tint is identifiable without opening the picker. */
  private colorMenuLabel(project: Project): string {
    if (project.color === undefined) return "Color";
    return `Color · ${projectColorName(project.color) ?? project.color}`;
  }

  private renderColorPicker(project: Project) {
    return html`
      <div class="project-color-picker" role="group" aria-label=${`Color for ${project.name}`}>
        <div class="project-color-swatches">
          ${PROJECT_COLORS.map((option) => html`
            <button
              class=${`project-color-swatch ${project.color?.toLowerCase() === option.value.toLowerCase() ? "active" : ""}`}
              style=${`--pi-swatch: ${option.value};`}
              title=${option.name}
              aria-label=${option.name}
              aria-pressed=${String(project.color?.toLowerCase() === option.value.toLowerCase())}
              @click=${() => { this.applyColor(project, option.value); }}
            ></button>
          `)}
        </div>
        <label class="project-color-custom">
          <span>Custom</span>
          <input
            type="color"
            .value=${project.color ?? "#8f8f8f"}
            title="Pick a custom color"
            aria-label=${`Custom color for ${project.name}`}
            @click=${(event: MouseEvent) => { event.stopPropagation(); }}
            @change=${(event: Event) => { this.applyCustomColor(project, event); }}
          />
        </label>
        ${project.color === undefined ? null : html`<button class="project-color-clear" title="Remove project color" @click=${() => { this.applyColor(project, undefined); }}>Clear color</button>`}
      </div>
    `;
  }

  private renderSortControl() {
    if (this.collapsed) return null;
    return html`
      <span class="project-sort">
        <button
          class="project-sort-toggle"
          title=${`Sort projects — ${projectSortLabel(this.sortMode)}`}
          aria-label=${`Sort projects, currently ${projectSortLabel(this.sortMode)}`}
          aria-expanded=${String(this.sortMenuOpen)}
          @click=${(event: MouseEvent) => { event.stopPropagation(); this.toggleSortMenu(event.currentTarget); }}
        >⇅</button>
        ${this.sortMenuOpen ? html`
          <div class="action-menu-panel" style=${this.sortMenuStyle} @click=${(event: MouseEvent) => { event.stopPropagation(); }}>
            ${PROJECT_SORT_MODES.map((mode) => html`
              <button aria-pressed=${String(this.sortMode === mode)} @click=${() => { this.applySort(mode); }}>${this.sortMode === mode ? "✓ " : ""}${projectSortLabel(mode)}</button>
            `)}
          </div>
        ` : null}
      </span>
    `;
  }

  private renderHeading() {
    if (!this.collapsible) return html`<span>Projects</span>`;
    const selectedSummary = this.selected?.name ?? "No project selected";
    const selectedTitle = this.selected?.path ?? selectedSummary;
    return html`<button class="section-toggle" aria-expanded=${String(!this.collapsed)} @click=${() => { this.onToggleCollapsed?.(); }}><span class="section-title"><span class="section-name">${this.collapsed ? "▸" : "▾"} Projects</span>${this.collapsed ? html`<small class="section-selected" title=${selectedTitle}>${selectedSummary}</small>` : null}</span><small class="section-count">${this.projects.length}</small></button>`;
  }

  /** Whether any session under this project posted a question nobody has answered. */
  private isAwaitingAnswer(project: Project): boolean {
    return hasStatusAsk(this.statusSnapshot?.projects[project.id]);
  }

  private renderActivity(project: Project) {
    const flags = this.statusSnapshot?.projects[project.id];
    const kind = statusActivityKind(flags);
    const unreadLabel = hasStatusUnread(flags) ? "Unread sessions in this project" : undefined;
    return renderActionActivityIndicator(kind, projectActivityLabel(kind), unreadLabel);
  }

  private toggleMenu(projectId: string, target: EventTarget | null) {
    if (this.openMenuProjectId === projectId) {
      this.openMenuProjectId = undefined;
      this.colorMenuProjectId = undefined;
      return;
    }
    this.menuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.openMenuProjectId = projectId;
    this.colorMenuProjectId = undefined;
    this.sortMenuOpen = false;
  }

  private toggleColorMenu(projectId: string) {
    this.colorMenuProjectId = this.colorMenuProjectId === projectId ? undefined : projectId;
  }

  private toggleSortMenu(target: EventTarget | null) {
    if (this.sortMenuOpen) {
      this.sortMenuOpen = false;
      return;
    }
    this.sortMenuStyle = actionMenuPanelStyle(target, { constrainTo: "viewport" });
    this.sortMenuOpen = true;
    this.openMenuProjectId = undefined;
    this.colorMenuProjectId = undefined;
  }

  private applySort(mode: ProjectSortMode) {
    this.sortMode = mode;
    this.sortMenuOpen = false;
    saveProjectSortMode(mode);
  }

  private applyColor(project: Project, color: string | undefined) {
    this.closeMenus();
    this.onSetColor?.(project, color);
  }

  private applyCustomColor(project: Project, event: Event) {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const color = normalizeProjectColor(input.value);
    if (color === undefined) return;
    this.applyColor(project, color);
  }

  private close(project: Project) {
    this.closeMenus();
    if (confirm(`Close ${project.name}?\n\nThis only removes it from PI WEB; it will not change the project folder.`)) this.onClose?.(project);
  }

  static override styles = [listStyles, css`

    .project-heading { gap: 6px; }
    .project-heading .section-toggle { flex: 1 1 auto; min-width: 0; }

    .project-sort { position: relative; flex: 0 0 auto; display: inline-flex; }
    .project-sort-toggle { display: grid; place-items: center; min-width: 22px; height: 20px; padding: 0 4px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: var(--pi-muted); font-size: 13px; line-height: 1; cursor: pointer; }
    .project-sort-toggle:hover { color: var(--pi-text); border-color: var(--pi-border); background: var(--pi-surface-hover); }
    .project-sort-toggle:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }

    /*
     * The colour fills the whole row pill (label side + the ⋯ button) so it reads as one
     * rounded rectangle. It is mixed into the surface rather than used raw so body text keeps
     * its contrast on both the light and dark themes, and so hover/selected still differ.
     * These selectors intentionally outrank .action-row.selected .action-main from listStyles.
     */
    .action-row.tinted .action-main, .action-row.tinted .action-menu-toggle {
      border-color: var(--pi-project-color);
      background-color: var(--pi-surface);
      background-image: linear-gradient(var(--pi-project-tint), var(--pi-project-tint));
    }
    .action-row.tinted:not(.selected):hover .action-main, .action-row.tinted:not(.selected):hover .action-menu-toggle {
      background-image: linear-gradient(var(--pi-project-tint-hover), var(--pi-project-tint-hover));
    }
    .action-row.tinted.selected .action-main, .action-row.tinted.selected .action-menu-toggle {
      border-color: var(--pi-accent);
      background-image: linear-gradient(var(--pi-project-tint-selected), var(--pi-project-tint-selected));
    }

    .project-color-picker { padding: 4px 6px 6px; border-bottom: 1px solid var(--pi-border); }
    .project-color-swatches { display: grid; grid-template-columns: repeat(5, 18px); gap: 5px; justify-content: start; }
    /*
     * Scoped under .action-menu-panel to outrank its button reset (border: 0; background:
     * transparent; display: block; width: 100%), which otherwise renders every swatch invisible.
     */
    .action-menu-panel .project-color-swatch {
      display: block;
      box-sizing: border-box;
      width: 18px;
      height: 18px;
      padding: 0;
      border: 1px solid var(--pi-border);
      border-radius: 50%;
      background: var(--pi-swatch);
      cursor: pointer;
    }
    .action-menu-panel .project-color-swatch:hover { background: var(--pi-swatch); outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    .action-menu-panel .project-color-swatch:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    .action-menu-panel .project-color-swatch.active { box-shadow: 0 0 0 2px var(--pi-surface), 0 0 0 3px var(--pi-text); }
    .project-color-custom { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-top: 6px; color: var(--pi-muted); font-size: 12px; }
    .project-color-custom input { width: 28px; height: 20px; padding: 0; border: 1px solid var(--pi-border); border-radius: 4px; background: transparent; cursor: pointer; }
    .action-menu-panel button.project-color-clear { margin-top: 4px; color: var(--pi-muted); font-size: 12px; }

    /*
     * Waiting for an answer outranks the project's own colour: attention beats
     * decoration. Declared last, and with one more class than the .tinted rules
     * above, so it wins for a coloured project in every row state.
     */
    /* The background shorthand clears the project's gradient overlay, so the
     * amber replaces the colour outright rather than layering over it. */
    .action-row.tinted.awaiting-answer .action-main, .action-row.tinted.awaiting-answer .action-menu-toggle {
      border-color: var(--pi-warning);
      background: color-mix(in srgb, var(--pi-warning) 22%, var(--pi-surface));
    }
    .action-row.tinted.awaiting-answer:not(.selected):hover .action-main, .action-row.tinted.awaiting-answer:not(.selected):hover .action-menu-toggle {
      background: color-mix(in srgb, var(--pi-warning) 32%, var(--pi-surface));
    }
    .action-row.tinted.awaiting-answer.selected .action-main, .action-row.tinted.awaiting-answer.selected .action-menu-toggle {
      border-color: var(--pi-accent);
      background: color-mix(in srgb, var(--pi-warning) 40%, var(--pi-surface));
    }
  `];
}

function projectActivityLabel(kind: ActivityIndicatorKind | undefined): string {
  if (kind === "ask") return "Waiting for your answer";
  if (kind === "terminal") return "Project terminal active";
  return "Project active";
}
