import { monitorEventLoopDelay } from "node:perf_hooks";
import { Session } from "node:inspector";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Diagnostic instrumentation for the intermittent pi-web-sessiond "wedge"
 * (event loop stalls hard enough that the health-check watchdog's 5s curl
 * probe gets zero bytes back and force-restarts the daemon). Purely
 * observational: logs event-loop-delay stats on a short cadence, and keeps a
 * rolling window of V8 CPU profiles on disk so that once a wedge is caught by
 * the watchdog we can look at exactly what the process was doing (self time
 * by function) during that window instead of guessing from source review.
 *
 * Safe to leave running indefinitely: the sampling profiler overhead is
 * low (~1%), and only the last few rotated profiles are kept.
 */

const LAG_LOG_INTERVAL_MS = 30_000;
/** Anything below this is normal jitter; only log loudly above it. */
const LAG_WARN_THRESHOLD_MS = 750;
const PROFILE_ROTATE_MS = 5 * 60 * 1000;
const PROFILE_RETAIN_COUNT = 6; // ~30 minutes of rolling history
const TOP_FUNCTIONS_LOGGED = 12;

export interface EventLoopWedgeMonitorLogger {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
  hitCount?: number;
  children?: number[];
}

interface CpuProfile {
  nodes: ProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
  startTime: number;
  endTime: number;
}

interface ProfilerStopResult {
  profile: CpuProfile;
}

function isProfilerStopResult(value: unknown): value is ProfilerStopResult {
  return typeof value === "object" && value !== null && "profile" in value;
}

function summarizeTopFunctions(profile: CpuProfile, limit: number): { fn: string; selfMs: number }[] {
  const selfTimeByNode = new Map<number, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  for (let i = 0; i < samples.length; i++) {
    const nodeId = samples[i];
    if (nodeId === undefined) continue;
    const deltaUs = deltas[i] ?? 0;
    selfTimeByNode.set(nodeId, (selfTimeByNode.get(nodeId) ?? 0) + deltaUs);
  }
  const byFn = new Map<string, number>();
  for (const node of profile.nodes) {
    const us = selfTimeByNode.get(node.id);
    if (us === undefined || us === 0) continue;
    const cf = node.callFrame;
    const label = `${cf.functionName || "(anonymous)"} ${cf.url}:${String(cf.lineNumber + 1)}`;
    byFn.set(label, (byFn.get(label) ?? 0) + us);
  }
  return [...byFn.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([fn, us]) => ({ fn, selfMs: Math.round(us / 100) / 10 }));
}

export function startEventLoopWedgeMonitor(options: {
  logger: EventLoopWedgeMonitorLogger;
  diagnosticsDir: string;
}): { dispose: () => Promise<void> } {
  const { logger, diagnosticsDir } = options;

  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const lagTimer = setInterval(() => {
    const maxMs = histogram.max / 1e6;
    const meanMs = histogram.mean / 1e6;
    const p99Ms = histogram.percentile(99) / 1e6;
    if (maxMs >= LAG_WARN_THRESHOLD_MS) {
      logger.warn(
        { maxMs: Math.round(maxMs), meanMs: Math.round(meanMs * 10) / 10, p99Ms: Math.round(p99Ms) },
        "event loop delay exceeded threshold in the last sampling window",
      );
    }
    histogram.reset();
  }, LAG_LOG_INTERVAL_MS);
  lagTimer.unref();

  const session = new Session();
  session.connect();
  let profilerReady = false;
  let disposed = false;
  let rotateTimer: NodeJS.Timeout | undefined;

  const dirReady = mkdir(diagnosticsDir, { recursive: true })
    .then(
      () =>
        new Promise<void>((resolve) => {
          session.post("Profiler.enable", () => {
            session.post("Profiler.start", () => {
              profilerReady = true;
              resolve();
            });
          });
        }),
    )
    .then(() => {
      if (disposed) return;
      rotateTimer = setInterval(() => { void rotate(); }, PROFILE_ROTATE_MS);
      rotateTimer.unref();
    })
    .catch((error: unknown) => {
      logger.warn({ err: error }, "event loop wedge monitor: failed to start CPU profiler; lag logging still active");
    });

  async function rotate(): Promise<void> {
    if (!profilerReady || disposed) return;
    await new Promise<void>((resolve) => {
      session.post("Profiler.stop", (err, result: unknown) => {
        if (err) {
          logger.warn({ err }, "event loop wedge monitor: profiler stop failed");
        } else if (isProfilerStopResult(result)) {
          void handleProfile(result.profile);
        }
        if (disposed) { resolve(); return; }
        session.post("Profiler.start", () => { resolve(); });
      });
    });
  }

  async function handleProfile(profile: CpuProfile): Promise<void> {
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const file = join(diagnosticsDir, `sessiond-cpu-${ts}.cpuprofile`);
    try {
      await writeFile(file, JSON.stringify(profile));
      const top = summarizeTopFunctions(profile, TOP_FUNCTIONS_LOGGED);
      logger.info(
        { file, windowMs: Math.round((profile.endTime - profile.startTime) / 1000), topSelfTime: top },
        "rotated CPU profile window; top self-time functions logged for post-wedge correlation",
      );
      await pruneOldProfiles();
    } catch (error: unknown) {
      logger.warn({ err: error }, "event loop wedge monitor: failed to persist CPU profile");
    }
  }

  async function pruneOldProfiles(): Promise<void> {
    try {
      const entries = (await readdir(diagnosticsDir)).filter((f) => f.startsWith("sessiond-cpu-") && f.endsWith(".cpuprofile")).sort();
      const excess = entries.length - PROFILE_RETAIN_COUNT;
      if (excess <= 0) return;
      await Promise.all(entries.slice(0, excess).map((f) => rm(join(diagnosticsDir, f), { force: true })));
    } catch {
      // best-effort cleanup; not worth failing the monitor over
    }
  }

  return {
    async dispose(): Promise<void> {
      disposed = true;
      clearInterval(lagTimer);
      if (rotateTimer !== undefined) clearInterval(rotateTimer);
      histogram.disable();
      await dirReady;
      if (profilerReady) {
        await new Promise<void>((resolve) => { session.post("Profiler.stop", () => { resolve(); }); });
      }
      session.disconnect();
    },
  };
}
