#!/usr/bin/env node
import CDP from "chrome-remote-interface";
import WebSocket from "ws";

const host = process.env.CDP_HOST ?? "127.0.0.1";
const port = Number(process.env.CDP_PORT ?? 9222);
const cmd = process.argv[2] ?? "list";

function usage() {
  console.error(`Usage:
  node scripts/webmcp-cdp.mjs list [url-substring]
  node scripts/webmcp-cdp.mjs watch [url-substring]
  node scripts/webmcp-cdp.mjs call <targetId-or-url-substring> <frameId> <toolName> '<json-input>'

Env: CDP_HOST=127.0.0.1 CDP_PORT=9222
`);
}

class BrowserCDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.listeners = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.on("message", data => this.#onMessage(JSON.parse(String(data))));
    await new Promise((resolve, reject) => {
      this.ws.once("open", resolve);
      this.ws.once("error", reject);
    });
  }
  #onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}: ${msg.error.data ?? ""}`));
      else resolve(msg.result ?? {});
      return;
    }
    const cbs = this.listeners.get(msg.method) ?? [];
    for (const cb of cbs) cb(msg.params ?? {}, msg.sessionId);
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    this.ws.send(JSON.stringify(msg));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  on(method, cb) {
    const list = this.listeners.get(method) ?? [];
    list.push(cb);
    this.listeners.set(method, list);
  }
  close() { this.ws?.close(); }
}

async function makeBrowserClient() {
  // New chrome://inspect remote-debugging mode returns 404 for /json/* but accepts this WS endpoint.
  const wsUrl = process.env.CDP_WS ?? `ws://${host}:${port}/devtools/browser`;
  const cdp = new BrowserCDP(wsUrl);
  await cdp.connect();
  return cdp;
}

async function listTargets(filter = "") {
  try {
    const targets = await CDP.List({ host, port });
    return targets.filter(t =>
      t.type === "page" && t.webSocketDebuggerUrl &&
      !t.url.startsWith("devtools://") && !t.url.startsWith("chrome://") &&
      (!filter || t.url.includes(filter) || (t.title ?? "").includes(filter) || t.id === filter)
    );
  } catch {
    const cdp = await makeBrowserClient();
    try {
      const { targetInfos } = await cdp.send("Target.getTargets");
      return targetInfos.filter(t =>
        t.type === "page" &&
        !t.url.startsWith("devtools://") && !t.url.startsWith("chrome://") &&
        (!filter || t.url.includes(filter) || (t.title ?? "").includes(filter) || t.targetId === filter)
      ).map(t => ({ id: t.targetId, title: t.title, url: t.url, type: t.type }));
    } finally { cdp.close(); }
  }
}

function wireEvents(cdp, target, sessionId, aggregate) {
  for (const name of ["WebMCP.toolsAdded", "WebMCP.toolsRemoved", "WebMCP.toolInvoked", "WebMCP.toolResponded"]) {
    cdp.on(name, (ev, evSessionId) => {
      if (evSessionId !== sessionId) return;
      if (name === "WebMCP.toolsAdded") {
        for (const tool of ev.tools ?? []) {
          const record = { targetId: target.id, title: target.title, url: target.url, ...tool };
          aggregate?.push(record);
          console.log(JSON.stringify({ event: "toolsAdded", ...record }, null, 2));
        }
      } else {
        console.log(JSON.stringify({ event: name.split(".")[1], targetId: target.id, url: target.url, ...ev }, null, 2));
      }
    });
  }
}

async function enableOnTarget(cdp, target, { keepOpen = false, aggregate = [] } = {}) {
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.id, flatten: true });
  wireEvents(cdp, target, sessionId, aggregate);
  await cdp.send("WebMCP.enable", {}, sessionId);
  await new Promise(resolve => setTimeout(resolve, 700));
  if (!keepOpen) await cdp.send("Target.detachFromTarget", { sessionId });
  return sessionId;
}

async function list(filter) {
  const targets = await listTargets(filter);
  if (!targets.length) return console.error("No matching page targets found.");
  const cdp = await makeBrowserClient();
  const all = [];
  try {
    for (const target of targets) {
      try { await enableOnTarget(cdp, target, { aggregate: all }); }
      catch (err) { console.error(JSON.stringify({ targetId: target.id, url: target.url, error: String(err.message ?? err) }, null, 2)); }
    }
  } finally { cdp.close(); }
  console.error(`Found ${all.length} WebMCP tool(s) across ${targets.length} page target(s).`);
}

async function watch(filter) {
  const targets = await listTargets(filter);
  if (!targets.length) throw new Error("No matching page targets found");
  const cdp = await makeBrowserClient();
  for (const target of targets) await enableOnTarget(cdp, target, { keepOpen: true });
  console.error(`Watching ${targets.length} target(s)... Ctrl-C to exit`);
  await new Promise(() => {});
}

async function call(selector, frameId, toolName, inputJson) {
  if (!selector || !frameId || !toolName || !inputJson) return usage();
  const [target] = await listTargets(selector);
  if (!target) throw new Error(`No matching target for ${selector}`);
  const input = JSON.parse(inputJson);
  const cdp = await makeBrowserClient();
  try {
    const sessionId = await enableOnTarget(cdp, target, { keepOpen: true });
    const response = await cdp.send("WebMCP.invokeTool", { frameId, toolName, input }, sessionId);
    console.log(JSON.stringify({ event: "invokeToolResult", targetId: target.id, url: target.url, ...response }, null, 2));
  } finally { setTimeout(() => cdp.close(), 2000); }
}

try {
  if (cmd === "list") await list(process.argv[3] ?? "");
  else if (cmd === "watch") await watch(process.argv[3] ?? "");
  else if (cmd === "call") await call(process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
  else { usage(); process.exit(2); }
} catch (err) {
  console.error(err);
  process.exit(1);
}
