/* MCP Bridge - WebSocket client that bridges MCP server to ExtendScript */

var PANEL_BUILD = "cep-bridge-1";

var cs = new CSInterface();
var ws = null;
var WS_PORT = 8097;

function log(msg) {
  var el = document.getElementById("log");
  var time = new Date().toLocaleTimeString();
  el.textContent += "[" + time + "] " + msg + "\n";
  el.scrollTop = el.scrollHeight;
}

function setStatus(text, className) {
  var el = document.getElementById("status");
  el.textContent = text;
  el.className = className;
}

var reconnectTimer = null;

function scheduleReconnect() {
  // Only ever one retry pending. Without this guard each close starts its own
  // retry chain, and every chain's connect() tears down the live socket.
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(function () {
    reconnectTimer = null;
    connect();
  }, 3000);
}

function connect() {
  // Already connected or mid-handshake -- leave the socket alone.
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  setStatus("Connecting...", "connecting");
  log("Connecting to MCP server on port " + WS_PORT + "...");

  var socket = new WebSocket("ws://localhost:" + WS_PORT);
  ws = socket;

  socket.onopen = function () {
    if (ws !== socket) return;
    setStatus("Connected", "connected");
    log("Connected to MCP server");
  };

  socket.onclose = function () {
    // Ignore a socket that has already been superseded.
    if (ws !== socket) return;
    setStatus("Disconnected", "disconnected");
    log("Disconnected from MCP server");
    scheduleReconnect();
  };

  socket.onerror = function (err) {
    if (ws !== socket) return;
    log("WebSocket error");
    // A refused connection may fire onerror WITHOUT a following onclose, which
    // would otherwise strand the panel with no retry pending. scheduleReconnect
    // is idempotent, so an onclose arriving afterwards costs nothing.
    setStatus("Disconnected", "disconnected");
    scheduleReconnect();
  };

  socket.onmessage = function (event) {
    try {
      var msg = JSON.parse(event.data);
      log("← " + msg.functionName + " (id: " + msg.id + ")");
      handleCommand(msg);
    } catch (e) {
      log("Error parsing message: " + e.message);
    }
  };
}

function handleCommand(msg) {
  var functionName = msg.functionName;
  var args = msg.args || [];

  if (functionName === "executeScript") {
    // Direct ExtendScript execution
    cs.evalScript(args[0], function (result) {
      sendResponse(msg.id, parseResult(result));
    });
    return;
  }

  // Build ExtendScript function call
  var argsStr = args
    .map(function (a) {
      if (typeof a === "string") return JSON.stringify(a);
      if (Array.isArray(a)) return JSON.stringify(a);
      return String(a);
    })
    .join(", ");

  var script = functionName + "(" + argsStr + ")";

  cs.evalScript(script, function (result) {
    sendResponse(msg.id, parseResult(result));
  });
}

function parseResult(result) {
  if (result === "EvalScript error." || result === "undefined") {
    return { error: result };
  }
  try {
    return JSON.parse(result);
  } catch (e) {
    return { value: result };
  }
}

function sendResponse(id, result) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    var response = { id: id };
    if (result && result.error) {
      response.error = result.error;
    } else {
      response.result = result;
    }
    ws.send(JSON.stringify(response));
    log("→ response (id: " + id + ")");
  }
}

// Load JSX modules on startup
var jsxLoaded = false;

function loadJSX() {
  var extPath = cs.getSystemPath(SystemPath.EXTENSION);
  var jsxPath = extPath + "/jsx";
  jsxPath = jsxPath.replace(/\\/g, "/");

  // First test if evalScript works at all
  log("Testing ExtendScript engine...");
  cs.evalScript('"hello"', function(result) {
    log("evalScript test: [" + result + "]");

    if (result === "EvalScript error.") {
      log("ExtendScript engine not ready, retrying in 2s...");
      setTimeout(loadJSX, 2000);
      return;
    }

    var modules = [
      // json2-polyfill first: later modules use JSON. Loaded here rather than
      // from premiere.jsx because $.fileName is empty on Premiere 26.3.2 arm64,
      // so only the panel can supply an absolute path. Harmless when the host
      // already has a native JSON (26.3.2 does) -- json2 defines only what is
      // missing.
      "json2-polyfill",
      "utils", "project", "sequence", "timeline", "effects",
      "markers", "audio", "export", "metadata", "captions",
      "graphics", "playback"
    ];

    // Load modules one at a time sequentially
    var idx = 0;
    function loadNext() {
      if (idx >= modules.length) {
        log("All JSX modules loaded");
        if (!jsxLoaded) {
          jsxLoaded = true;
          connect();
        }
        return;
      }
      var mod = modules[idx];
      var script = '$.evalFile("' + jsxPath + '/' + mod + '.jsx")';
      cs.evalScript(script, function(r) {
        if (r === "EvalScript error.") {
          log("Failed to load: " + mod + ".jsx");
        } else {
          log("Loaded: " + mod + ".jsx");
        }
        idx++;
        loadNext();
      });
    }
    loadNext();
  });
}

// Start - small delay to let ExtendScript engine initialize
log("panel build: " + PANEL_BUILD);
setTimeout(loadJSX, 1000);

// Watchdog: the MCP server only listens while a Claude session owns it, so the
// panel must survive arbitrarily long stretches with nothing on the port.
// connect() returns early when the socket is OPEN or CONNECTING, so polling it
// is cheap and cannot disturb a healthy connection.
// Not gated on jsxLoaded: the socket does not depend on the ExtendScript engine,
// and gating it means a stalled engine leaves the panel dark forever.
setInterval(connect, 5000);
