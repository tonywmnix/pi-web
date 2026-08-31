import { api as defaultApi, type Project, type SessionInfo } from "../api";
import { selectedMachineId, type GetState, type SetState } from "./types";
import type { WorkspaceController } from "./workspaceController";

/**
 * Trust choice the add-project dialog submits with the path. `changed` is
 * false for the pre-filled existing/default value, so adding a project never
 * pins a decision the user did not make in this dialog.
 */
export interface ProjectTrustChoice {
  trusted: boolean;
  changed: boolean;
}

export interface ProjectControllerDependencies {
  api?: Pick<typeof defaultApi, "projects" | "addProject" | "closeProject" | "setWorkspaceTrust" | "setProjectColor" | "sessions">;
}

export class ProjectController {
  private readonly api: Pick<typeof defaultApi, "projects" | "addProject" | "closeProject" | "setWorkspaceTrust" | "setProjectColor" | "sessions">;

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly workspaces: Pick<WorkspaceController, "selectProject" | "forgetProject" | "clearSelection">,
    deps: ProjectControllerDependencies = {},
  ) {
    this.api = deps.api ?? defaultApi;
  }

  async loadProjects() {
    const machineId = selectedMachineId(this.getState());
    this.setState({ error: "", isLoadingProjects: true });
    try {
      const projects = await this.api.projects(machineId);
      if (selectedMachineId(this.getState()) !== machineId) return;
      const projectIds = new Set(projects.map((project) => project.id));
      const workspacesByProjectId = Object.fromEntries(Object.entries(this.getState().workspacesByProjectId).filter(([projectId]) => projectIds.has(projectId)));
      this.setState({ projects, workspacesByProjectId });
    } catch (error) {
      if (selectedMachineId(this.getState()) === machineId) this.setState({ error: String(error) });
    } finally {
      if (selectedMachineId(this.getState()) === machineId) this.setState({ isLoadingProjects: false });
    }
    await this.refreshProjectActivity(machineId);
  }

  /**
   * Best-effort per-project "last conversation" timestamps for the `recent`
   * project sort. Each project is queried by its own path only — a secondary
   * worktree workspace under the same project is not included — which covers
   * the common single-workspace project without a full workspace fan-out.
   * Fetch failures for individual projects are swallowed so one unreachable
   * project cannot blank the whole sort.
   */
  private async refreshProjectActivity(machineId: string): Promise<void> {
    const projects = this.getState().projects;
    const entries = await Promise.all(projects.map(async (project): Promise<readonly [string, string] | undefined> => {
      try {
        const sessions = await this.api.sessions(project.path, machineId);
        const latest = latestSessionModifiedAt(sessions);
        return latest === undefined ? undefined : [project.id, latest] as const;
      } catch {
        return undefined;
      }
    }));
    if (selectedMachineId(this.getState()) !== machineId) return;
    const activity: Record<string, string> = {};
    for (const entry of entries) if (entry !== undefined) activity[entry[0]] = entry[1];
    this.setState({ projectActivity: activity });
  }

  async addProject(path: string, create?: boolean, trustChoice?: ProjectTrustChoice) {
    if (path.trim() === "") return;
    const machineId = selectedMachineId(this.getState());
    try {
      const project = await this.api.addProject(path.trim(), undefined, create, machineId);
      if (selectedMachineId(this.getState()) !== machineId) return;
      const projects = this.getState().projects;
      this.setState({ projects: [...projects.filter((p) => p.id !== project.id), project], projectDialogOpen: false });
      await this.workspaces.selectProject(project);
      if (trustChoice?.changed === true) {
        await this.applyTrustChoice(project, trustChoice.trusted, machineId);
      }
    } catch (error) {
      if (selectedMachineId(this.getState()) === machineId) this.setState({ error: String(error) });
    }
  }

  /**
   * Pin the dialog's trust choice once the project's main workspace exists.
   * The write goes through the id-based trust route (server-resolved path),
   * never a client-chosen path; without a main workspace the project simply
   * keeps its default trust.
   */
  private async applyTrustChoice(project: Project, trusted: boolean, machineId: string): Promise<void> {
    const mainWorkspace = this.getState().workspaces.find((workspace) => workspace.isMain);
    if (mainWorkspace === undefined) return;
    await this.api.setWorkspaceTrust(project.id, mainWorkspace.id, trusted, machineId);
  }

  /** Persists the project's accent colour, keeping the selected project in sync so the header recolours too. */
  async setProjectColor(projectId: string, color: string | undefined) {
    const machineId = selectedMachineId(this.getState());
    try {
      const updated = await this.api.setProjectColor(projectId, color, machineId);
      if (selectedMachineId(this.getState()) !== machineId) return;
      const state = this.getState();
      this.setState({
        projects: state.projects.map((p) => (p.id === projectId ? updated : p)),
        ...(state.selectedProject?.id === projectId ? { selectedProject: updated } : {}),
      });
    } catch (error) {
      if (selectedMachineId(this.getState()) === machineId) this.setState({ error: String(error) });
    }
  }

  async closeProject(projectId: string) {
    const machineId = selectedMachineId(this.getState());
    try {
      await this.api.closeProject(projectId, machineId);
      if (selectedMachineId(this.getState()) !== machineId) return;
      this.workspaces.forgetProject(projectId);
      const state = this.getState();
      this.setState({ projects: state.projects.filter((p) => p.id !== projectId) });
      if (state.selectedProject?.id === projectId) this.workspaces.clearSelection();
    } catch (error) {
      if (selectedMachineId(this.getState()) === machineId) this.setState({ error: String(error) });
    }
  }
}

/** Unparseable timestamps are ignored rather than allowed to poison the max with NaN. */
function latestSessionModifiedAt(sessions: readonly SessionInfo[]): string | undefined {
  let latest: string | undefined;
  let latestValue = Number.NEGATIVE_INFINITY;
  for (const session of sessions) {
    const value = Date.parse(session.modified);
    if (Number.isNaN(value) || value <= latestValue) continue;
    latestValue = value;
    latest = session.modified;
  }
  return latest;
}
