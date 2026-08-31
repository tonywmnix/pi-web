import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { isAskSoundEnabled, setAskSoundEnabled } from "../../askSound";
import { areNotificationsEnabled, notificationGuidance, notificationSupport, requestNotificationPermission, setNotificationsEnabled } from "../../agentNotifications";
import type { Machine, MachineHealth, Project, SessionActivity, SessionInfo, SessionStatus, Workspace } from "../../api";
import type { MachineStatusSnapshot } from "../../../../shared/machineStatus";
import type { WorkspaceLabelItem } from "../../plugins/types";
import { selectedMachineId } from "../../controllers/types";
import type { NavigationSection } from "../../appShell/navigationState";
import { NAVIGATION_SECTION_ORDER } from "../../appShell/navigationState";
import type { KeyboardNavigableSection } from "../navigationFocus";
import "../MachineList";
import "../MachineSwitcher";
import "../ProjectList";
import "../WorkspaceList";
import "../SessionList";

export type NavigationFocusTarget = NavigationSection | "chat";

@customElement("app-navigation-panel")
export class AppNavigationPanel extends LitElement {
  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) selectedMachine?: Machine;
  @property({ attribute: false }) machineStatuses: Record<string, MachineHealth> = {};
  @property({ attribute: false }) machineStatusSnapshots: Record<string, MachineStatusSnapshot> = {};
  @property({ attribute: false }) projects: Project[] = [];
  /** Project id → last-conversation timestamp, fetched separately from `projects` itself. */
  @property({ attribute: false }) projectActivity: Readonly<Record<string, string>> = {};
  @property({ attribute: false }) selectedProject?: Project;
  @property({ attribute: false }) workspaces: Workspace[] = [];
  @property({ attribute: false }) selectedWorkspace?: Workspace;
  @property({ attribute: false }) sessions: SessionInfo[] = [];
  @property({ attribute: false }) selectedSession?: SessionInfo;
  @property({ attribute: false }) sessionActivities: Record<string, SessionActivity> = {};
  @property({ attribute: false }) sessionStatuses: Record<string, SessionStatus> = {};
  @property({ attribute: false }) sendingPrompts: Record<string, true> = {};
  @property({ attribute: false }) unreadSessionIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) deletingWorkspaceIds: string[] = [];
  @property({ attribute: false }) workspaceLabelItems: (workspace: Workspace) => WorkspaceLabelItem[] = () => [];
  @property({ attribute: false }) refreshControl: unknown;
  @property({ type: Boolean, reflect: true }) collapsible = false;
  @property({ type: Boolean, reflect: true }) compact = false;
  @property({ type: Boolean }) machinesCollapsed = false;
  @property({ type: Boolean }) projectsCollapsed = false;
  @property({ type: Boolean }) workspacesCollapsed = false;
  @property({ type: Boolean }) sessionsCollapsed = false;
  @property({ type: Number }) startingSessionCount = 0;
  @property({ type: Boolean }) canStartSession = false;
  @property({ attribute: false }) onShowActions?: () => void;
  @property({ attribute: false }) onToggleMachines?: () => void;
  @property({ attribute: false }) onToggleProjects?: () => void;
  @property({ attribute: false }) onToggleWorkspaces?: () => void;
  @property({ attribute: false }) onToggleSessions?: () => void;
  @property({ attribute: false }) onSelectProject?: (project: Project) => void | Promise<void>;
  @property({ attribute: false }) onCloseProject?: (project: Project) => void | Promise<void>;
  @property({ attribute: false }) onSetProjectColor?: (project: Project, color: string | undefined) => void | Promise<void>;
  @property({ attribute: false }) onSelectWorkspace?: (workspace: Workspace) => void | Promise<void>;
  @property({ attribute: false }) onDeleteWorkspace?: (workspace: Workspace) => void | Promise<void>;
  @property({ attribute: false }) onStartSession?: () => void | Promise<void>;
  @property({ attribute: false }) onSelectSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onArchiveSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onArchiveSessionWithDescendants?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onArchiveSessions?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onRestoreSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onDeleteCachedNewSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onDeleteArchivedSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onDeleteArchivedSessions?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onDetachParentSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onMarkSessionRead?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onMarkSessionsRead?: (sessions: SessionInfo[]) => void | Promise<void>;
  @property({ attribute: false }) onReloadSession?: (session: SessionInfo) => void | Promise<void>;
  @property({ attribute: false }) onCleanupSessions?: () => void | Promise<void>;
  @property({ attribute: false }) onArchivedCollapsed?: () => void | Promise<void>;
  @property({ attribute: false }) onSelectMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onRemoveMachine?: (machine: Machine) => void | Promise<void>;
  @property({ attribute: false }) onFocusNavigationTarget?: (target: NavigationFocusTarget) => void | Promise<void>;
  @property({ attribute: false }) onCancelKeyboardNavigation?: () => void | Promise<void>;

  /**
   * Browser-local, so it is read and written here rather than threaded through
   * app state: whether a sound is welcome depends on the device, not the project.
   */
  @state() private askSoundEnabled = isAskSoundEnabled();
  @state() private desktopNotificationsEnabled = areNotificationsEnabled();
  @state() private notificationPermission = notificationSupport();
  @state() private notificationNotice = "";

  @query("machine-list") private machineList?: KeyboardNavigableSection;
  @query("machine-switcher") private machineSwitcher?: KeyboardNavigableSection;
  @query("project-list") private projectList?: KeyboardNavigableSection;
  @query("workspace-list") private workspaceList?: KeyboardNavigableSection;
  @query("session-list") private sessionList?: KeyboardNavigableSection;

  private toggleAskSound(): void {
    this.askSoundEnabled = !this.askSoundEnabled;
    setAskSoundEnabled(this.askSoundEnabled);
  }

  private notificationTitle(): string {
    if (this.notificationPermission === "unsupported") return "This browser does not support desktop notifications";
    if (this.notificationPermission === "denied") return "Desktop notifications are blocked in browser settings";
    if (!this.desktopNotificationsEnabled) return "Desktop notifications are off";
    return "Desktop notifications are on for questions and finished runs";
  }

  /**
   * Turning these on asks the browser for permission, which is only allowed
   * from a user gesture - hence requesting here rather than at startup.
   */
  private async toggleDesktopNotifications(): Promise<void> {
    if (this.desktopNotificationsEnabled) {
      this.desktopNotificationsEnabled = false;
      setNotificationsEnabled(false);
      this.notificationNotice = "";
      return;
    }
    this.notificationPermission = notificationSupport() === "default"
      ? await requestNotificationPermission()
      : notificationSupport();
    const granted = this.notificationPermission === "granted";
    this.desktopNotificationsEnabled = granted;
    setNotificationsEnabled(granted);
    this.notificationNotice = notificationGuidance(this.notificationPermission) ?? "";
  }

  /**
   * Permission can change outside this button - the address-bar control is the
   * only way back from a block, and the browser tells the page nothing when it
   * is used. Re-reading whenever the tab comes back makes granting it there
   * take effect without a reload.
   */
  private readonly syncNotificationPermission = (): void => {
    const permission = notificationSupport();
    if (permission === this.notificationPermission) return;
    this.notificationPermission = permission;
    if (permission !== "granted") return;
    this.notificationNotice = "";
    if (areNotificationsEnabled()) this.desktopNotificationsEnabled = true;
  };

  override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener("visibilitychange", this.syncNotificationPermission);
    window.addEventListener("focus", this.syncNotificationPermission);
  }

  override disconnectedCallback(): void {
    document.removeEventListener("visibilitychange", this.syncNotificationPermission);
    window.removeEventListener("focus", this.syncNotificationPermission);
    super.disconnectedCallback();
  }

  async focusSection(section: NavigationSection): Promise<boolean> {
    await this.updateComplete;
    switch (section) {
      case "machines": return await this.focusNavigableSection(this.compact ? this.machineList : this.machineSwitcher);
      case "projects": return await this.focusNavigableSection(this.projectList);
      case "workspaces": return await this.focusNavigableSection(this.workspaceList);
      case "sessions": return await this.focusNavigableSection(this.sessionList);
    }
  }

  override render() {
    return html`
      <header>
        <strong>PI WEB</strong>
        <button
          class="ask-sound-toggle"
          aria-pressed=${String(this.askSoundEnabled)}
          title=${this.askSoundEnabled ? "Question alert sound is on" : "Question alert sound is off"}
          aria-label=${this.askSoundEnabled ? "Turn off the question alert sound" : "Turn on the question alert sound"}
          @click=${() => { this.toggleAskSound(); }}
        >${this.askSoundEnabled ? "\u{1F514}" : "\u{1F515}"}</button>
        <button
          class="ask-sound-toggle"
          aria-pressed=${String(this.desktopNotificationsEnabled && this.notificationPermission === "granted")}
          title=${this.notificationTitle()}
          aria-label=${this.notificationTitle()}
          @click=${() => { void this.toggleDesktopNotifications(); }}
        >\u{1F5A5}</button>
        ${shouldShowMachinesSection(this.machines) ? html`
          <machine-switcher
            .machines=${this.machines}
            .selected=${this.selectedMachine}
            .statuses=${this.machineStatuses}
            .statusSnapshots=${this.machineStatusSnapshots}
            .onSelect=${(machine: Machine) => this.onSelectMachine?.(machine)}
            .onRemove=${(machine: Machine) => this.onRemoveMachine?.(machine)}
            .onFocusNextSection=${() => { this.focusNextFrom("machines"); }}
            .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
          ></machine-switcher>
        ` : null}
        <div class="header-actions">
          ${this.refreshControl}
          <button title="Show Actions" aria-label="Show Actions" @click=${() => { this.onShowActions?.(); }}>Actions</button>
        </div>
      </header>
      ${this.notificationNotice === "" ? null : html`
        <p class="notification-notice" role="status">
          <span>${this.notificationNotice}</span>
          <button
            type="button"
            class="notice-dismiss"
            title="Dismiss"
            aria-label="Dismiss notification message"
            @click=${() => { this.notificationNotice = ""; }}
          >\u2715</button>
        </p>
      `}
      ${this.compact && shouldShowMachinesSection(this.machines) ? html`
        <machine-list
          .machines=${this.machines}
          .selected=${this.selectedMachine}
          .statuses=${this.machineStatuses}
          .statusSnapshots=${this.machineStatusSnapshots}
          .collapsible=${this.collapsible}
          .collapsed=${this.machinesCollapsed}
          .onToggleCollapsed=${() => { this.onToggleMachines?.(); }}
          .onSelect=${(machine: Machine) => this.onSelectMachine?.(machine)}
          .onRemove=${(machine: Machine) => this.onRemoveMachine?.(machine)}
          .onFocusNextSection=${() => { this.focusNextFrom("machines"); }}
          .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
        ></machine-list>
      ` : null}
      <project-list
        .projects=${this.projects}
        .activity=${this.liveProjectActivity()}
        .selected=${this.selectedProject}
        .statusSnapshot=${this.selectedMachineStatusSnapshot()}
        .collapsible=${this.collapsible}
        .collapsed=${this.projectsCollapsed}
        .onToggleCollapsed=${() => { this.onToggleProjects?.(); }}
        .onSelect=${(project: Project) => this.onSelectProject?.(project)}
        .onClose=${(project: Project) => this.onCloseProject?.(project)}
        .onSetColor=${(project: Project, color: string | undefined) => this.onSetProjectColor?.(project, color)}
        .onFocusPreviousSection=${() => { this.focusPreviousFrom("projects"); }}
        .onFocusNextSection=${() => { this.focusNextFrom("projects"); }}
        .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
      ></project-list>
      <workspace-list
        .workspaces=${this.workspaces}
        .selected=${this.selectedWorkspace}
        .machineId=${this.selectedMachine?.id ?? "local"}
        .statusSnapshot=${this.selectedMachineStatusSnapshot()}
        .deletingWorkspaceIds=${this.deletingWorkspaceIds}
        .collapsible=${this.collapsible}
        .collapsed=${this.workspacesCollapsed}
        .workspaceLabelItems=${this.workspaceLabelItems}
        .onToggleCollapsed=${() => { this.onToggleWorkspaces?.(); }}
        .onSelect=${(workspace: Workspace) => this.onSelectWorkspace?.(workspace)}
        .onDelete=${(workspace: Workspace) => this.onDeleteWorkspace?.(workspace)}
        .onFocusPreviousSection=${() => { this.focusPreviousFrom("workspaces"); }}
        .onFocusNextSection=${() => { this.focusNextFrom("workspaces"); }}
        .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
      ></workspace-list>
      <session-list
        .sessions=${this.sessions}
        .statuses=${this.sessionStatuses}
        .activities=${this.sessionActivities}
        .sending=${this.sendingPrompts}
        .unreadSessionIds=${this.unreadSessionIds}
        .selected=${this.selectedSession}
        .startingCount=${this.startingSessionCount}
        .canStart=${this.canStartSession}
        .collapsible=${this.collapsible}
        .collapsed=${this.sessionsCollapsed}
        .onToggleCollapsed=${() => { this.onToggleSessions?.(); }}
        .onArchivedCollapsed=${() => this.onArchivedCollapsed?.()}
        .onStart=${() => this.onStartSession?.()}
        .onSelect=${(session: SessionInfo) => this.onSelectSession?.(session)}
        .onArchive=${(session: SessionInfo) => this.onArchiveSession?.(session)}
        .onArchiveWithDescendants=${(session: SessionInfo) => this.onArchiveSessionWithDescendants?.(session)}
        .onArchiveMany=${(sessions: SessionInfo[]) => this.onArchiveSessions?.(sessions)}
        .onRestore=${(session: SessionInfo) => this.onRestoreSession?.(session)}
        .onDelete=${(session: SessionInfo) => this.onDeleteCachedNewSession?.(session)}
        .onDeleteArchived=${(session: SessionInfo) => this.onDeleteArchivedSession?.(session)}
        .onDeleteArchivedMany=${(sessions: SessionInfo[]) => this.onDeleteArchivedSessions?.(sessions)}
        .onDetachParent=${(session: SessionInfo) => this.onDetachParentSession?.(session)}
        .onMarkRead=${(session: SessionInfo) => this.onMarkSessionRead?.(session)}
        .onMarkReadMany=${(sessions: SessionInfo[]) => this.onMarkSessionsRead?.(sessions)}
        .onReload=${(session: SessionInfo) => this.onReloadSession?.(session)}
        .onCleanup=${() => this.onCleanupSessions?.()}
        .onFocusPreviousSection=${() => { this.focusPreviousFrom("sessions"); }}
        .onFocusNextSection=${() => { this.focusNextFrom("sessions"); }}
        .onCancelKeyboardNavigation=${() => { this.cancelKeyboardNavigation(); }}
      ></session-list>
    `;
  }

  /**
   * Project and workspace rows always belong to the selected machine, resolved
   * exactly as the rest of the app resolves it — including its local-machine
   * default, which is the key snapshots arrive under before a machine has been
   * selected. Diverging here would blank every row's indicator while a snapshot
   * is in fact loaded.
   */
  private selectedMachineStatusSnapshot(): MachineStatusSnapshot | undefined {
    return this.machineStatusSnapshots[selectedMachineId({ selectedMachine: this.selectedMachine })];
  }

  /**
   * `projectActivity` is fetched separately and can lag behind live traffic, so
   * the selected project's own entry is overridden with the freshest `modified`
   * timestamp already sitting in `sessions` — otherwise sending a message in the
   * open project would not move it to the top of a "recent" sort until the next
   * background refresh.
   */
  private liveProjectActivity(): Readonly<Record<string, string>> {
    const selectedId = this.selectedProject?.id;
    if (selectedId === undefined) return this.projectActivity;
    let latest: string | undefined;
    for (const session of this.sessions) {
      if (latest === undefined || Date.parse(session.modified) > Date.parse(latest)) latest = session.modified;
    }
    if (latest === undefined) return this.projectActivity;
    const known = this.projectActivity[selectedId];
    if (known !== undefined && Date.parse(known) >= Date.parse(latest)) return this.projectActivity;
    return { ...this.projectActivity, [selectedId]: latest };
  }

  private async focusNavigableSection(section: KeyboardNavigableSection | undefined): Promise<boolean> {
    if (section === undefined) return false;
    return await section.focusSelectedOrFirst();
  }

  private focusPreviousFrom(section: NavigationSection): void {
    const target = previousVisibleNavigationTarget(section, this.machines);
    if (target !== undefined) void this.onFocusNavigationTarget?.(target);
  }

  private focusNextFrom(section: NavigationSection): void {
    void this.onFocusNavigationTarget?.(nextVisibleNavigationTarget(section, this.machines));
  }

  private cancelKeyboardNavigation(): void {
    void this.onCancelKeyboardNavigation?.();
  }

  static override styles = css`
    :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
    :host([compact]) { flex: 1 1 auto; }
    header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-bottom: 1px solid var(--pi-border); }
    .ask-sound-toggle { flex: 0 0 auto; margin-left: auto; min-width: 26px; height: 22px; padding: 0 4px; border: 1px solid transparent; border-radius: 6px; background: transparent; font-size: 13px; line-height: 1; cursor: pointer; }
    .ask-sound-toggle:hover { border-color: var(--pi-border); background: var(--pi-surface-hover); }
    .ask-sound-toggle:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    .ask-sound-toggle[aria-pressed="false"] { opacity: 0.55; }
    .notification-notice { flex: 0 0 auto; display: flex; align-items: flex-start; gap: 8px; margin: 0; padding: 8px 12px; border-bottom: 1px solid var(--pi-border); background: var(--pi-surface); color: var(--pi-text-muted); font-size: 12px; line-height: 1.4; }
    .notification-notice span { flex: 1 1 auto; min-width: 0; }
    .notice-dismiss { flex: 0 0 auto; padding: 0 4px; border: 1px solid transparent; border-radius: 6px; background: transparent; color: inherit; font-size: 12px; line-height: 1.4; cursor: pointer; }
    .notice-dismiss:hover { border-color: var(--pi-border); background: var(--pi-surface-hover); }
    header strong { flex: 0 0 auto; }
    machine-switcher { flex: 1 1 auto; min-width: 0; }
    :host([compact]) header { display: none; }
    .header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; }
    /* Expanded sections share the panel height equally, so collapsing one
       section distributes its space to every remaining section, not just the
       session list. Collapsed sections keep only their heading height. */
    machine-list, project-list, workspace-list, session-list { flex: 1 1 0px; min-height: 0; overflow: hidden; border-bottom: 1px solid var(--pi-border-muted); }
    machine-list[collapsed],
    project-list[collapsed],
    workspace-list[collapsed],
    session-list[collapsed] { flex: 0 0 auto; min-height: auto; overflow: hidden; }
    button { border: 1px solid var(--pi-border); border-radius: 8px; background: var(--pi-surface); color: var(--pi-text); padding: 7px 9px; cursor: pointer; }
  `;
}

export function shouldShowMachinesSection(machines: readonly Machine[]): boolean {
  return machines.length > 1;
}

function previousVisibleNavigationTarget(section: NavigationSection, machines: readonly Machine[]): NavigationSection | undefined {
  const sections = visibleNavigationSections(machines);
  return sections[sections.indexOf(section) - 1];
}

function nextVisibleNavigationTarget(section: NavigationSection, machines: readonly Machine[]): NavigationFocusTarget {
  const sections = visibleNavigationSections(machines);
  return sections[sections.indexOf(section) + 1] ?? "chat";
}

function visibleNavigationSections(machines: readonly Machine[]): NavigationSection[] {
  return NAVIGATION_SECTION_ORDER.filter((section) => section !== "machines" || shouldShowMachinesSection(machines));
}
