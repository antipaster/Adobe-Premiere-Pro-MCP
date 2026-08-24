import { WebSocketServer, WebSocket } from "ws";
import { loadConfig } from "./config.js";

const WS_PORT = loadConfig().port;
const TIMEOUT_MS = 30000;

let cepSocket: WebSocket | null = null;
let pendingRequests = new Map<string, { resolve: (v: any) => void; reject: (e: Error) => void }>();
let requestId = 0;

const REBIND_MS = 3000;

function attachHandlers(server: WebSocketServer) {
  server.on("connection", (ws) => {
    console.error(`[Bridge] CEP panel connected`);
    cepSocket = ws;

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const pending = pendingRequests.get(msg.id);
        if (pending) {
          pendingRequests.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
      } catch (e) {
        console.error("[Bridge] Failed to parse message:", e);
      }
    });

    ws.on("close", () => {
      console.error("[Bridge] CEP panel disconnected");
      cepSocket = null;
      for (const [id, pending] of pendingRequests) {
        pending.reject(new Error("CEP panel disconnected"));
        pendingRequests.delete(id);
      }
    });
  });
}

// Every Claude window spawns its own `node server.js`, but only one can bind
// WS_PORT for the Premiere CEP bridge. A loser must NOT give up permanently:
// whichever instance holds the port may exit at any time (window closed, session
// restarted), and without a retry every surviving instance stays useless for the
// rest of its life, reporting "Premiere Pro is not connected" forever.
function bind() {
  const server = new WebSocketServer({ port: WS_PORT });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      // Another instance owns the bridge. Retry until it releases the port.
      try {
        server.close();
      } catch {}
      setTimeout(bind, REBIND_MS);
    } else {
      console.error("[Bridge] WebSocket server error:", err);
    }
  });

  server.on("listening", () => {
    console.error(`[Bridge] WebSocket server listening on port ${WS_PORT}`);
  });

  attachHandlers(server);
}

bind();

export function isConnected(): boolean {
  return cepSocket !== null && cepSocket.readyState === WebSocket.OPEN;
}

export function getPort(): number {
  return WS_PORT;
}

export function callPremiere(functionName: string, args: any[] = []): Promise<any> {
  return new Promise((resolve, reject) => {
    if (!isConnected()) {
      reject(new Error("Premiere Pro is not connected. Make sure the MCP Bridge panel is open in Premiere Pro."));
      return;
    }

    const id = String(++requestId);
    pendingRequests.set(id, { resolve, reject });

    cepSocket!.send(JSON.stringify({ id, functionName, args }));

    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Timeout waiting for Premiere Pro response (${functionName})`));
      }
    }, TIMEOUT_MS);
  });
}

export function toolResult(result: any) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}
