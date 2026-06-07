import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import WebSocket from "ws";

const DEFAULT_HOST = process.env.CDP_HOST ?? "127.0.0.1";
const DEFAULT_PORT = Number(process.env.CDP_PORT ?? 9222);
const DEFAULT_WS = process.env.CDP_WS ?? `ws://${DEFAULT_HOST}:${DEFAULT_PORT}/devtools/browser`;

type TargetInfo = { targetId: string; title: string; url: string; type: string };
type WebMcpTool = {
  targetId: string;
  title: string;
  url: string;
  name: string;
  description?: string;
  inputSchema?: any;
  frameId: string;
  [key: string]: any;
};

class BrowserCDP {
  private ws?: WebSocket;
  private id = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private listeners = new Map<string, Array<(params: any, sessionId?: string) => void>>();

  constructor(private wsUrl: string) { }

  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    this.ws.on("message", data => this.onMessage(JSON.parse(String(data))));
    await new Promise<void>((resolve, reject) => {
      this.ws!.once("open", () => resolve());
      this.ws!.once("error", reject);
    });
  }

  private onMessage(msg: any) {
    if (msg.id && this.pending.has(msg.id)) {
      const pending = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(`${msg.error.message}: ${msg.error.data ?? ""}`));
      else pending.resolve(msg.result ?? {});
      return;
    }
    for (const cb of this.listeners.get(msg.method) ?? []) cb(msg.params ?? {}, msg.sessionId);
  }

  send(method: string, params: any = {}, sessionId?: string) {
    const id = ++this.id;
    this.ws!.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise<any>((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  on(method: string, cb: (params: any, sessionId?: string) => void) {
    const list = this.listeners.get(method) ?? [];
    list.push(cb);
    this.listeners.set(method, list);
  }

  close() { this.ws?.close(); }
}

function safeName(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "tool";
}

function toolSchema(schema: any) {
  // WebMCP schemas are JSON Schema-shaped and generally compatible enough for pi's TypeBox validator.
  return schema && typeof schema === "object" ? schema : Type.Object({}, { additionalProperties: true });
}

async function openBrowser() {
  const cdp = new BrowserCDP(DEFAULT_WS);
  await cdp.connect();
  return cdp;
}

async function getPageTargets(cdp: BrowserCDP, filter = ""): Promise<TargetInfo[]> {
  const { targetInfos } = await cdp.send("Target.getTargets");
  return (targetInfos as TargetInfo[]).filter(t =>
    t.type === "page" &&
    !t.url.startsWith("chrome://") &&
    !t.url.startsWith("devtools://") &&
    (!filter || t.url.includes(filter) || t.title?.includes(filter) || t.targetId === filter)
  );
}

async function scanWebMcpTools(filter = ""): Promise<WebMcpTool[]> {
  const cdp = await openBrowser();
  const found: WebMcpTool[] = [];
  try {
    const targets = await getPageTargets(cdp, filter);
    for (const target of targets) {
      let sessionId: string | undefined;
      try {
        ({ sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true }));
        cdp.on("WebMCP.toolsAdded", (ev, evSessionId) => {
          if (evSessionId !== sessionId) return;
          for (const tool of ev.tools ?? []) {
            found.push({ targetId: target.targetId, title: target.title, url: target.url, ...tool });
          }
        });
        await cdp.send("WebMCP.enable", {}, sessionId);
        await new Promise(resolve => setTimeout(resolve, 500));
      } finally {
        if (sessionId) await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => { });
      }
    }
    return found;
  } finally {
    cdp.close();
  }
}

async function invokeWebMcpTool(tool: WebMcpTool, input: any): Promise<any> {
  const cdp = await openBrowser();
  try {
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: tool.targetId, flatten: true });
    try {
      await cdp.send("WebMCP.enable", {}, sessionId);
      const invokeResult = await cdp.send("WebMCP.invokeTool", {
        frameId: tool.frameId,
        toolName: tool.name,
        input,
      }, sessionId);

      const invocationId = invokeResult.invocationId;
      const response = await new Promise<any>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out waiting for WebMCP.toolResponded")), 60_000);
        cdp.on("WebMCP.toolResponded", (ev, evSessionId) => {
          if (evSessionId !== sessionId) return;
          if (!invocationId || ev.invocationId === invocationId) {
            clearTimeout(timer);
            resolve(ev);
          }
        });
      });
      return { invokeResult, response };
    } finally {
      await cdp.send("Target.detachFromTarget", { sessionId }).catch(() => { });
    }
  } finally {
    cdp.close();
  }
}

export default function webMcpExtension(pi: ExtensionAPI) {
  const registered = new Set<string>();
  const registry = new Map<string, WebMcpTool>();

  async function registerDiscovered(filter = "", notify?: (msg: string) => void) {
    const tools = await scanWebMcpTools(filter);
    for (const tool of tools) {
      const base = `webmcp_${safeName(tool.name)}`;
      let name = base;
      let i = 2;
      while (registered.has(name) && registry.get(name)?.targetId !== tool.targetId) name = `${base}_${i++}`;
      registry.set(name, tool);
      if (registered.has(name)) continue;
      registered.add(name);

      pi.registerTool({
        name,
        label: `WebMCP: ${tool.name}`,
        description: tool.description ?? `Invoke WebMCP tool ${tool.name} on ${tool.url}`,
        promptSnippet: `${tool.description ?? tool.name} (WebMCP page tool from ${new URL(tool.url).hostname})`,
        promptGuidelines: [`Use ${name} only when the user asks to operate on the open browser page exposing ${tool.name}.`],
        parameters: toolSchema(tool.inputSchema),
        async execute(_toolCallId, params) {
          const latest = registry.get(name) ?? tool;
          const result = await invokeWebMcpTool(latest, params);
          return {
            content: [{ type: "text", text: JSON.stringify(result.response, null, 2) }],
            details: { tool: latest, result },
          };
        },
      });
    }
    notify?.(`Registered ${tools.length} discovered WebMCP tool(s).`);
    return tools;
  }

  pi.registerTool({
    name: "webmcp_scan_tools",
    label: "WebMCP Scan Tools",
    description: "Scan open Chrome tabs for WebMCP tools and register them as pi tools.",
    promptSnippet: "Scan open Chrome tabs for WebMCP tools and dynamically register each as a pi tool",
    parameters: Type.Object({ filter: Type.Optional(Type.String({ description: "Optional URL/title/target filter" })) }),
    async execute(_toolCallId, params) {
      const tools = await registerDiscovered(params.filter ?? "");
      return {
        content: [{ type: "text", text: `Registered/scanned ${tools.length} WebMCP tool(s):\n${tools.map(t => `- ${t.name} @ ${t.title}`).join("\n")}` }],
        details: { tools },
      };
    },
  });

  pi.registerCommand("webmcp-scan", {
    description: "Scan Chrome for WebMCP tools and register them as pi tools",
    handler: async (args, ctx) => {
      try {
        const tools = await registerDiscovered(args.trim(), msg => ctx.ui.notify(msg, "info"));
        ctx.ui.notify(`WebMCP scan complete: ${tools.length} tool(s).`, "info");
      } catch (err: any) {
        ctx.ui.notify(`WebMCP scan failed: ${err.message ?? err}`, "error");
      }
    },
  });

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.notify("WebMCP extension loaded. Run /webmcp-scan or call webmcp_scan_tools.", "info");
  });
}
