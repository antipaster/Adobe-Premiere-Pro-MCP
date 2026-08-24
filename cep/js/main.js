/* MCP Bridge - WebSocket client that bridges MCP server to ExtendScript */

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

function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  setStatus("Connecting...", "connecting");
  log("Connecting to MCP server on port " + WS_PORT + "...");

  ws = new WebSocket("ws://localhost:" + WS_PORT);

  ws.onopen = function () {
    setStatus("Connected", "connected");
    log("Connected to MCP server");
  };

  ws.onclose = function () {
    setStatus("Disconnected", "disconnected");
    log("Disconnected from MCP server");
    // Auto-reconnect after 3 seconds
    setTimeout(connect, 3000);
  };

  ws.onerror = function (err) {
    log("WebSocket error");
  };

  ws.onmessage = function (event) {
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
        connect();
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
setTimeout(loadJSX, 1000);
