/* MCP Bridge - ExtendScript entry point. Modules loaded by CEP panel.

   This file must NEVER throw. CEP loads it as the manifest ScriptPath, and a
   failure here poisons the entire ExtendScript context: every later
   evalScript() call -- even "1+1" -- returns "EvalScript error." forever.

   It used to resolve the JSON polyfill via $.fileName, but $.fileName is an
   empty string on Premiere Pro 26.3.2 (macOS arm64), so the relative path
   never resolved and $.evalFile threw. The polyfill is now loaded by the panel
   from an absolute path instead (see loadJSX in js/main.js). */
var _mcpReady = true;
