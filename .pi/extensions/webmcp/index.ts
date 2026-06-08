import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import CDP from "chrome-remote-interface";
import type { Client } from "chrome-remote-interface";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

const DEFAULT_HOST = process.env.CDP_HOST ?? "127.0.0.1";
const DEFAULT_PORT = Number(process.env.CDP_PORT ?? 9222);
const DEFAULT_WS = process.env.CDP_WS ?? `ws://${DEFAULT_HOST}:${DEFAULT_PORT}/devtools/browser`;

type TargetInfo = { targetId: string; title: string; url: string; type: string };
type WebMcpTool = {
  targetId: string;
  title: string;
  url: string;
  origin: string;
  name: string;
  description?: string;
  inputSchema?: any;
  frameId: string;
  [key: string]: any;
};

type CdpClient = Client & {
  send(method: string, params?: any, sessionId?: string): Promise<any>;
  on(method: string, cb: (params: any, sessionId?: string) => void): void;
  once(method: string, cb: (...args: any[]) => void): void;
  close(): Promise<void> | void;
};

function safeName(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "tool";
}

function originName(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0];
  }
}

function toolId(tool: WebMcpTool) {
  return `${safeName(tool.origin)}__${safeName(tool.name)}`;
}

function formatSchema(schema: any, indent = 2): string {
  if (!schema || typeof schema !== "object") return "  (none)";
  const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const lines = Object.entries(properties).map(([name, prop]: [string, any]) => {
    const type = prop?.enum ? `enum: ${prop.enum.map((v: any) => JSON.stringify(v)).join(", ")}` : prop?.type ?? "any";
    const req = required.has(name) ? "required" : "optional";
    const desc = prop?.description ? ` - ${prop.description}` : "";
    return `${" ".repeat(indent)}- ${name} (${type}, ${req})${desc}`;
  });
  return lines.length ? lines.join("\n") : `${" ".repeat(indent)}(no parameters)`;
}

let browserClient: CdpClient | undefined;
const attachedSessions = new Map<string, string>();

async function openBrowser(): Promise<CdpClient> {
  if (browserClient) return browserClient;
  browserClient = await CDP({ target: DEFAULT_WS, local: true }) as CdpClient;
  const clear = () => {
    browserClient = undefined;
    attachedSessions.clear();
  };
  browserClient.once?.("disconnect", clear);
  browserClient.once?.("error", clear);
  return browserClient;
}

async function disconnectBrowser(): Promise<void> {
  const cdp = browserClient;
  if (!cdp) return;

  const sessions = [...attachedSessions.values()];
  attachedSessions.clear();
  browserClient = undefined;

  await Promise.allSettled(
    sessions.map(sessionId => cdp.send("Target.detachFromTarget", { sessionId })),
  );
  await Promise.resolve(cdp.close());
}

async function getAttachedSession(cdp: CdpClient, targetId: string): Promise<string> {
  const existing = attachedSessions.get(targetId);
  if (existing) return existing;
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  attachedSessions.set(targetId, sessionId);
  await cdp.send("WebMCP.enable", {}, sessionId);
  return sessionId;
}

async function getPageTargets(cdp: CdpClient, filter = ""): Promise<TargetInfo[]> {
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
  const targets = await getPageTargets(cdp, filter);
  for (const target of targets) {
    const sessionId = await getAttachedSession(cdp, target.targetId);
    const before = found.length;
    const handler = (ev: any, evSessionId?: string) => {
      if (evSessionId !== sessionId) return;
      for (const tool of ev.tools ?? []) {
        found.push({
          targetId: target.targetId,
          title: target.title,
          url: target.url,
          origin: originName(target.url),
          ...tool,
        });
      }
    };
    cdp.on("WebMCP.toolsAdded", handler);
    await cdp.send("WebMCP.enable", {}, sessionId);
    await new Promise(resolve => setTimeout(resolve, 500));
    if (found.length === before) {
      // No tools reported for this target during the scan window.
    }
  }
  return found;
}

async function invokeWebMcpTool(tool: WebMcpTool, input: any): Promise<any> {
  const cdp = await openBrowser();
  const sessionId = await getAttachedSession(cdp, tool.targetId);
  let invocationId: string | undefined;
  const responsePromise = new Promise<any>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(
        "Timed out waiting for WebMCP.toolResponded. The page accepted the invocation but did not respond; declarative form tools may require the page/form to opt into toolautosubmit or otherwise call event.respondWith(...).",
      ));
    }, 60_000);
    cdp.on("WebMCP.toolResponded", (ev: any, evSessionId?: string) => {
      if (evSessionId !== sessionId) return;
      if (!invocationId || ev.invocationId === invocationId) {
        clearTimeout(timer);
        resolve(ev);
      }
    });
  });

  const invokeResult: any = await cdp.send("WebMCP.invokeTool", {
    frameId: tool.frameId,
    toolName: tool.name,
    input,
  }, sessionId);
  invocationId = invokeResult.invocationId;

  const response = await responsePromise;
  return { invokeResult, response };
}

function upsertTools(registry: Map<string, WebMcpTool>, tools: WebMcpTool[]) {
  for (const tool of tools) {
    registry.set(toolId(tool), tool);
  }
}

function hiddenToolRender() {
  return new Text("", 0, 0);
}

function listToolsText(tools: WebMcpTool[]) {
  if (tools.length === 0) return "No WebMCP tools found. Use webmcp_list({ filter: \"optional filter\" }) to scan open Chrome tabs.";
  const byOrigin = new Map<string, WebMcpTool[]>();
  for (const tool of tools) {
    const group = byOrigin.get(tool.origin) ?? [];
    group.push(tool);
    byOrigin.set(tool.origin, group);
  }
  const lines: string[] = [];
  for (const [origin, originTools] of [...byOrigin.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`${origin}:`);
    for (const tool of originTools.sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`  - ${toolId(tool)} (${tool.name}) @ ${tool.title}`);
      if (tool.description) lines.push(`    ${tool.description}`);
    }
  }
  return lines.join("\n");
}

export default function webMcpExtension(pi: ExtensionAPI) {
  const registry = new Map<string, WebMcpTool>();

  pi.on("session_shutdown", async () => {
    await disconnectBrowser();
  });

  function hiddenDiscoveryMessage(tools: WebMcpTool[]) {
    if (tools.length === 0) return;
    pi.sendMessage?.({
      customType: "webmcp-discovery",
      content: `New WebMCP tool(s) discovered:\n${listToolsText(tools)}\n\nUse webmcp_describe to inspect parameters and webmcp_execute with the listed origin to invoke a tool.`,
      display: false,
    }, { triggerTurn: false, deliverAs: "steer" });
  }

  async function scanAndStore(filter = "", announce = false) {
    const tools = await scanWebMcpTools(filter);
    const newTools = tools.filter(tool => !registry.has(toolId(tool)));
    upsertTools(registry, tools);
    if (announce) hiddenDiscoveryMessage(newTools);
    return tools;
  }

  const resolveTool = (name: string, origin?: string) => {
    const candidates = [...registry.values()].filter(t =>
      (toolId(t) === name || t.name === name) && (!origin || t.origin === origin)
    );
    return candidates.length === 1 ? candidates[0] : { candidates };
  };

  pi.registerTool({
    name: "webmcp_list",
    label: "WebMCP List",
    description: "Scan open Chrome tabs for WebMCP tools and list known tools grouped by origin.",
    promptSnippet: "List WebMCP tools exposed by open browser tabs, grouped by origin",
    promptGuidelines: [
      "For user requests that may involve an open browser page or page-specific action, call webmcp_list before saying no page tool is available.",
      "Use webmcp_list to get each tool's id, name, origin, and description before calling webmcp_describe or webmcp_execute.",
    ],
    parameters: Type.Object({
      filter: Type.Optional(Type.String({ description: "Optional URL/title/target/origin filter for scanning open tabs." })),
      refresh: Type.Optional(Type.Boolean({ description: "Force a new scan even if tools are already known. Default: true." })),
    }),
    renderCall: hiddenToolRender,
    renderResult: hiddenToolRender,
    async execute(_toolCallId, params) {
      if (params.refresh !== false || registry.size === 0) await scanAndStore(params.filter ?? "", true);
      const tools = [...registry.values()].filter(t =>
        !params.filter || t.url.includes(params.filter) || t.title?.includes(params.filter) || t.origin.includes(params.filter) || t.targetId === params.filter
      );
      return { content: [{ type: "text" as const, text: listToolsText(tools) }], details: { tools } };
    },
  });

  (pi.registerTool as (tool: unknown) => unknown)({
    name: "webmcp_describe",
    label: "WebMCP Describe",
    description: "Describe a WebMCP tool's page, origin, description, and input parameters.",
    promptSnippet: "Inspect a WebMCP page tool schema before executing it",
    promptGuidelines: [
      "Use webmcp_describe when you need a WebMCP tool's exact parameters before execution.",
    ],
    parameters: Type.Object({
      tool: Type.String({ description: "Tool id from webmcp_list, or the page-provided tool name." }),
      origin: Type.Optional(Type.String({ description: "Origin/host where the tool is registered, without protocol (e.g. example.com)." })),
    }),
    renderCall: hiddenToolRender,
    renderResult: hiddenToolRender,
    async execute(_toolCallId: string, params: { tool: string; origin?: string }) {
      if (registry.size === 0) await scanAndStore("");
      const resolved = resolveTool(params.tool, params.origin);
      if ("candidates" in resolved) {
        return { content: [{ type: "text" as const, text: resolved.candidates.length ? `Ambiguous tool. Provide origin.\n\n${listToolsText(resolved.candidates)}` : `Tool not found: ${params.tool}. Try webmcp_list first.` }], details: { candidates: resolved.candidates } };
      }
      const id = toolId(resolved);
      const text = `${id}\nOrigin: ${resolved.origin}\nName: ${resolved.name}\nPage: ${resolved.title}\nURL: ${resolved.url}\n\n${resolved.description ?? "(no description)"}\n\nParameters:\n${formatSchema(resolved.inputSchema)}`;
      return { content: [{ type: "text" as const, text }], details: { tool: resolved, id } };
    },
  });

  (pi.registerTool as (tool: unknown) => unknown)({
    name: "webmcp_execute",
    label: "WebMCP Execute",
    description: "Execute a WebMCP tool exposed by an open Chrome tab.",
    promptSnippet: "Execute a selected WebMCP page tool with JSON arguments",
    promptGuidelines: [
      "Before using webmcp_execute, use webmcp_list and usually webmcp_describe to identify the correct tool and parameters.",
      "When calling webmcp_execute, pass both tool and origin from webmcp_list to disambiguate same-named tools on different sites.",
    ],
    parameters: Type.Object({
      tool: Type.String({ description: "Tool id from webmcp_list, or the page-provided tool name." }),
      origin: Type.String({ description: "Origin/host where the tool is registered, without protocol (e.g. example.com)." }),
      args: Type.Optional(Type.String({ description: "Arguments as a JSON object string for the WebMCP tool." })),
    }),
    async execute(_toolCallId: string, params: { tool: string; origin: string; args?: string }) {
      if (registry.size === 0) await scanAndStore("");
      const resolved = resolveTool(params.tool, params.origin);
      if ("candidates" in resolved) {
        return { content: [{ type: "text" as const, text: resolved.candidates.length ? `Ambiguous tool. Retry with origin.\n\n${listToolsText(resolved.candidates)}` : `Tool not found: ${params.tool}. Try webmcp_list first.` }], details: { candidates: resolved.candidates, error: "tool_not_found_or_ambiguous" } };
      }
      let input: Record<string, unknown> = {};
      if (params.args) {
        input = JSON.parse(params.args);
        if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("args must be a JSON object string");
      }
      const result = await invokeWebMcpTool(resolved, input);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result.response, null, 2) }],
        details: { id: toolId(resolved), origin: resolved.origin, tool: resolved, result },
      };
    },
  });

  pi.registerTool({
    name: "webmcp_disconnect",
    label: "WebMCP Disconnect",
    description: "Disconnect from Chrome remote debugging and clear known WebMCP tools.",
    parameters: Type.Object({}),
    renderCall: hiddenToolRender,
    renderResult: hiddenToolRender,
    async execute() {
      await disconnectBrowser();
      registry.clear();
      return { content: [{ type: "text" as const, text: "WebMCP disconnected and registry cleared." }], details: {} };
    },
  });

  pi.registerCommand("webmcp-connect", {
    description: "Scan Chrome WebMCP tools",
    handler: async (args, ctx) => {
      try {
        const tools = await scanAndStore(args.trim(), true);
        ctx.ui.notify(`WebMCP scanned: ${tools.length} tool(s).`, "info");
      } catch (err: any) {
        ctx.ui.notify(`WebMCP scan failed: ${err.message ?? err}`, "error");
      }
    },
  });

  pi.registerCommand("webmcp-disconnect", {
    description: "Disconnect pi from Chrome's remote debugging session",
    handler: async (_args, ctx) => {
      await disconnectBrowser();
      registry.clear();
      ctx.ui.notify("WebMCP disconnected from Chrome.", "info");
    },
  });
}
