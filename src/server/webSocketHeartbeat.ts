import type { FastifyInstance } from "fastify";

/** Interval between liveness sweeps. Each sweep terminates peers that ignored the previous ping. */
export const DEFAULT_WEB_SOCKET_HEARTBEAT_MS = 30_000;

const OPEN = 1;

/** The `ws` socket surface a sweep needs: liveness probe, forced teardown, pong notification. */
export interface HeartbeatSocket {
  readonly readyState: number;
  ping(): void;
  terminate(): void;
  on(event: "pong", listener: () => void): unknown;
}

export interface HeartbeatServer {
  readonly clients: ReadonlySet<HeartbeatSocket>;
  on(event: "connection", listener: (socket: HeartbeatSocket) => void): unknown;
}

export interface WebSocketHeartbeatOptions {
  intervalMs?: number;
  /** Injected by tests; defaults to an unref'd global interval. */
  scheduleSweep?: (sweep: () => void, intervalMs: number) => () => void;
  onTerminate?: (socket: HeartbeatSocket) => void;
}

/**
 * Terminates WebSocket peers that stop answering pings.
 *
 * A connection can die without a TCP FIN — a sleeping laptop, a dropped VPN,
 * the WSL localhost relay — and then both ends still report OPEN. Nothing else
 * in the transport notices: the server keeps publishing session frames into a
 * void and never releases the socket. Pinging turns that silent half-open state
 * into a real close, which is also what lets the browser's reconnect fire.
 */
export function startWebSocketHeartbeat(server: HeartbeatServer, options: WebSocketHeartbeatOptions = {}): () => void {
  const awaitingPong = new WeakSet<HeartbeatSocket>();
  server.on("connection", (socket) => {
    socket.on("pong", () => { awaitingPong.delete(socket); });
  });

  const sweep = (): void => {
    for (const socket of server.clients) {
      if (socket.readyState !== OPEN) continue;
      if (awaitingPong.has(socket)) {
        awaitingPong.delete(socket);
        socket.terminate();
        options.onTerminate?.(socket);
        continue;
      }
      awaitingPong.add(socket);
      socket.ping();
    }
  };

  const schedule = options.scheduleSweep ?? scheduleWithGlobalTimer;
  return schedule(sweep, options.intervalMs ?? DEFAULT_WEB_SOCKET_HEARTBEAT_MS);
}

/** Starts a sweep over a Fastify instance's WebSocket server and stops it when the server closes. */
export function installWebSocketHeartbeat(app: FastifyInstance, options: WebSocketHeartbeatOptions = {}): void {
  const stop = startWebSocketHeartbeat(app.websocketServer, options);
  app.addHook("onClose", (_instance, done) => {
    stop();
    done();
  });
}

function scheduleWithGlobalTimer(sweep: () => void, intervalMs: number): () => void {
  const timer = setInterval(sweep, intervalMs);
  timer.unref();
  return () => { clearInterval(timer); };
}
