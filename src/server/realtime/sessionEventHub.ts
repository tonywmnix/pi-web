import type { GlobalSessionEvent, RealtimeEvent, SessionNotificationSummaryEvent, SessionUiEvent } from "../../shared/apiTypes.js";
import { projectBrowserSessionEvent } from "../browserMessageProjection.js";

/**
 * Frame type of the stream keepalive. Deliberately outside the event
 * vocabulary: it is transport liveness, not session state, and every client
 * parser drops it.
 */
export const SESSION_STREAM_KEEPALIVE_TYPE = "stream.keepalive";

/** How often {@link startSessionEventKeepalive} publishes a keepalive frame. */
export const DEFAULT_SESSION_EVENT_KEEPALIVE_MS = 30_000;

export interface RealtimeSocket {
  readonly OPEN: number;
  readyState: number;
  send(payload: string): void;
  terminate(): void;
  on(event: "close", listener: () => void): unknown;
}

export class SessionEventHub {
  private readonly socketsBySession = new Map<string, Set<RealtimeSocket>>();
  private readonly globalSockets = new Set<RealtimeSocket>();
  private readonly seqBySession = new Map<string, number>();
  private globalJoinFrame: (() => RealtimeEvent) | undefined;

  add(sessionId: string, socket: RealtimeSocket): void {
    let sockets = this.socketsBySession.get(sessionId);
    if (!sockets) {
      sockets = new Set();
      this.socketsBySession.set(sessionId, sockets);
    }
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  }

  /**
   * Frame sent to each global subscriber the moment it joins, before any live
   * event. It closes the join race for state the browser would otherwise only
   * fetch over HTTP: with two proxy hops in federation, that fetch can resolve
   * before the upstream subscription exists and then be clobbered by a stale
   * value.
   */
  setGlobalJoinFrame(frame: () => RealtimeEvent): void {
    this.globalJoinFrame = frame;
  }

  addGlobal(socket: RealtimeSocket): void {
    this.globalSockets.add(socket);
    socket.on("close", () => this.globalSockets.delete(socket));
    const joinFrame = this.globalJoinFrame?.();
    if (joinFrame !== undefined) this.sendToSocket(this.globalSockets, socket, JSON.stringify(joinFrame));
  }

  publish(sessionId: string, event: SessionUiEvent): void {
    const seq = (this.seqBySession.get(sessionId) ?? 0) + 1;
    this.seqBySession.set(sessionId, seq);
    const payload = JSON.stringify({ ...projectBrowserSessionEvent(event), seq });
    this.sendToSockets(this.socketsBySession.get(sessionId), payload);
  }

  /**
   * Last per-session sequence number stamped by {@link publish} (0 before any
   * event). Callers building a join-time stream snapshot read this as the
   * watermark: buffered live events with `seq <= currentSeq` are already
   * reflected in the snapshot's partial and must be dropped by the client.
   */
  currentSeq(sessionId: string): number {
    return this.seqBySession.get(sessionId) ?? 0;
  }

  publishGlobal(event: GlobalSessionEvent): void {
    this.publishRealtime(event);
  }

  publishNotificationSummary(event: SessionNotificationSummaryEvent): void {
    const payload = JSON.stringify(event);
    this.sendToSockets(this.globalSockets, payload);
  }

  publishRealtime(event: RealtimeEvent): void {
    const payload = JSON.stringify(event);
    this.sendToSockets(this.globalSockets, payload);
  }

  /**
   * Sends a frame every subscriber can observe simply by arriving.
   *
   * Browsers cannot see WebSocket protocol pongs, so a page has no way to tell
   * a quiet stream from a dead one. This gives it a positive liveness signal on
   * a known cadence; clients that do not recognise the frame drop it, which is
   * why it carries no payload beyond its type.
   */
  publishKeepalive(): void {
    const payload = JSON.stringify({ type: SESSION_STREAM_KEEPALIVE_TYPE });
    for (const sockets of this.socketsBySession.values()) this.sendToSockets(sockets, payload);
    this.sendToSockets(this.globalSockets, payload);
  }

  private sendToSockets(sockets: Set<RealtimeSocket> | undefined, payload: string): void {
    if (sockets === undefined) return;
    for (const socket of sockets) this.sendToSocket(sockets, socket, payload);
  }

  private sendToSocket(sockets: Set<RealtimeSocket>, socket: RealtimeSocket, payload: string): void {
    if (socket.readyState !== socket.OPEN) return;
    try {
      socket.send(payload);
    } catch {
      sockets.delete(socket);
      try {
        socket.terminate();
      } catch {
        // Removal is authoritative; cleanup failure must not block healthy sockets.
      }
    }
  }
}

export interface SessionEventKeepaliveOptions {
  intervalMs?: number;
  /** Injected by tests; defaults to an unref'd global interval. */
  scheduleKeepalive?: (publish: () => void, intervalMs: number) => () => void;
}

/** Publishes hub keepalive frames on an interval; returns a disposer. */
export function startSessionEventKeepalive(
  hub: Pick<SessionEventHub, "publishKeepalive">,
  options: SessionEventKeepaliveOptions = {},
): () => void {
  const publish = (): void => { hub.publishKeepalive(); };
  const schedule = options.scheduleKeepalive ?? scheduleWithGlobalTimer;
  return schedule(publish, options.intervalMs ?? DEFAULT_SESSION_EVENT_KEEPALIVE_MS);
}

function scheduleWithGlobalTimer(publish: () => void, intervalMs: number): () => void {
  const timer = setInterval(publish, intervalMs);
  timer.unref();
  return () => { clearInterval(timer); };
}
