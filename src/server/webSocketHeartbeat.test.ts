import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { startWebSocketHeartbeat, type HeartbeatServer, type HeartbeatSocket } from "./webSocketHeartbeat.js";

const servers = new Set<WebSocketServer>();
const sockets = new Set<WebSocket>();

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  await Promise.all(Array.from(servers, closeSocketServer));
  sockets.clear();
  servers.clear();
});

describe("startWebSocketHeartbeat", () => {
  it("terminates a peer that stops answering pings", async () => {
    const socketServer = createServer();
    await waitForListening(socketServer);
    const sweeps = manualSweeps();
    startWebSocketHeartbeat(socketServer, { scheduleSweep: sweeps.schedule });

    // autoPong: false is the closest honest stand-in for a half-open
    // connection: the peer is reachable enough to stay OPEN but never answers.
    const client = connect(socketServer, { autoPong: false });
    const serverSocket = await nextConnection(socketServer);
    const closed = nextClose(client);

    sweeps.run();
    expect(serverSocket.readyState).toBe(WebSocket.OPEN);
    sweeps.run();

    await closed;
    expect(serverSocket.readyState).toBe(WebSocket.CLOSED);
  });

  it("keeps a peer that answers pings, sweep after sweep", async () => {
    const socketServer = createServer();
    await waitForListening(socketServer);
    const sweeps = manualSweeps();
    startWebSocketHeartbeat(socketServer, { scheduleSweep: sweeps.schedule });

    const client = connect(socketServer);
    const serverSocket = await nextConnection(socketServer);

    for (let round = 0; round < 3; round += 1) {
      const ponged = nextPong(serverSocket);
      sweeps.run();
      await ponged;
    }

    expect(serverSocket.readyState).toBe(WebSocket.OPEN);
    expect(client.readyState).toBe(WebSocket.OPEN);
  });

  it("skips sockets that are not open instead of pinging them", () => {
    const closing = fakeSocket(WebSocket.CLOSING);
    const server = fakeServer([closing]);
    const sweeps = manualSweeps();
    startWebSocketHeartbeat(server, { scheduleSweep: sweeps.schedule });

    sweeps.run();
    sweeps.run();

    expect(closing.ping).not.toHaveBeenCalled();
    expect(closing.terminate).not.toHaveBeenCalled();
  });

  it("stops sweeping once the returned disposer runs", () => {
    const socket = fakeSocket(WebSocket.OPEN);
    const server = fakeServer([socket]);
    const sweeps = manualSweeps();
    const stop = startWebSocketHeartbeat(server, { scheduleSweep: sweeps.schedule });

    sweeps.run();
    expect(socket.ping).toHaveBeenCalledOnce();

    stop();
    expect(sweeps.stopped).toBe(true);
  });
});

interface ManualSweeps {
  schedule: (sweep: () => void, intervalMs: number) => () => void;
  run: () => void;
  stopped: boolean;
}

function manualSweeps(): ManualSweeps {
  let sweep: (() => void) | undefined;
  const controller: ManualSweeps = {
    schedule: (nextSweep) => {
      sweep = nextSweep;
      return () => { controller.stopped = true; };
    },
    run: () => {
      if (sweep === undefined) throw new Error("expected a scheduled sweep");
      sweep();
    },
    stopped: false,
  };
  return controller;
}

interface FakeSocket extends HeartbeatSocket {
  ping: Mock<() => void>;
  terminate: Mock<() => void>;
}

function fakeSocket(readyState: number): FakeSocket {
  return { readyState, ping: vi.fn<() => void>(), terminate: vi.fn<() => void>(), on: vi.fn() };
}

function fakeServer(clients: HeartbeatSocket[]): HeartbeatServer {
  return { clients: new Set(clients), on: vi.fn() };
}

function createServer(): WebSocketServer {
  const socketServer = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  servers.add(socketServer);
  return socketServer;
}

function connect(socketServer: WebSocketServer, options: { autoPong?: boolean } = {}): WebSocket {
  const client = new WebSocket(serverUrl(socketServer), options);
  sockets.add(client);
  return client;
}

function nextConnection(socketServer: WebSocketServer): Promise<WebSocket> {
  return new Promise((resolve) => {
    socketServer.once("connection", (socket) => {
      sockets.add(socket);
      resolve(socket);
    });
  });
}

function closeSocketServer(socketServer: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve) => {
    socketServer.close(() => { resolve(); });
  });
}

function waitForListening(socketServer: WebSocketServer): Promise<void> {
  if (socketServer.address() !== null) return Promise.resolve();
  return new Promise((resolve, reject) => {
    socketServer.once("error", reject);
    socketServer.once("listening", () => {
      socketServer.off("error", reject);
      resolve();
    });
  });
}

function serverUrl(socketServer: WebSocketServer): string {
  const address = socketServer.address();
  if (address === null || typeof address === "string") throw new Error("Expected TCP server address");
  return `ws://127.0.0.1:${String(address.port)}`;
}

function nextPong(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    socket.once("pong", () => { resolve(); });
  });
}

function nextClose(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    socket.once("close", () => { resolve(); });
  });
}
