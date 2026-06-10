import { keyHint, keyText, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getKeybindings, Text } from "@earendil-works/pi-tui";
import CDP from "chrome-remote-interface";
import type { Client } from "chrome-remote-interface";
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
  return safeName(tool.name);
}

function registryKey(tool: WebMcpTool) {
  return `${tool.origin}::${tool.frameId}::${tool.name}`;
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
const targetInfoById = new Map<string, TargetInfo>();
const targetIdBySession = new Map<string, string>();

async function openBrowser(): Promise<CdpClient> {
  if (browserClient) return browserClient;
  browserClient = await CDP({ target: DEFAULT_WS, local: true }) as CdpClient;
  const clear = () => {
    browserClient = undefined;
    attachedSessions.clear();
    targetInfoById.clear();
    targetIdBySession.clear();
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
  targetInfoById.clear();
  targetIdBySession.clear();
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
  targetIdBySession.set(sessionId, targetId);
  await cdp.send("WebMCP.enable", {}, sessionId);
  return sessionId;
}

async function getPageTargets(cdp: CdpClient, filter = ""): Promise<TargetInfo[]> {
  const { targetInfos } = await cdp.send("Target.getTargets");
  const pages = (targetInfos as TargetInfo[]).filter(t =>
    t.type === "page" &&
    !t.url.startsWith("chrome://") &&
    !t.url.startsWith("devtools://")
  );
  for (const target of pages) targetInfoById.set(target.targetId, target);
  return pages.filter(t =>
    !filter || t.url.includes(filter) || t.title?.includes(filter) || t.targetId === filter
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
    registry.set(registryKey(tool), tool);
  }
}

function renderToolCall(toolName: string, args: { tool?: string; origin?: string }, theme: any, includeExpandHint = false) {
  const origin = args.origin ? theme.fg("accent", args.origin) : theme.fg("dim", "unknown origin");
  const tool = args.tool ? theme.fg("toolOutput", args.tool) : theme.fg("dim", "unknown tool");
  let text = `${theme.fg("toolTitle", theme.bold(toolName))} ${origin} ${theme.fg("dim", "→")} ${tool}`;
  if (includeExpandHint) text += `\n\n${theme.fg("dim", `(${keyText("app.tools.expand")} to expand)`)}`;
  return new Text(text, 0, 0);
}

function renderExecuteCall(args: { tool?: string; origin?: string }, theme: any) {
  return renderToolCall("webmcp_execute", args, theme, true);
}

function renderDescribeCall(args: { tool?: string; origin?: string }, theme: any) {
  return renderToolCall("webmcp_describe", args, theme);
}

function renderDescribeResult(_result: unknown) {
  return new Text("", 0, 0);
}

function renderListCall(_args: { filter?: string }, theme: any) {
  return new Text(`${theme.fg("toolTitle", theme.bold("webmcp_list"))} ${theme.fg("dim", `(${keyHint("app.tools.expand", "to show tools")})`)}`, 0, 0);
}

function renderListResult(result: { content?: Array<{ type: string; text?: string }> }, { expanded, isPartial }: { expanded: boolean; isPartial: boolean }, theme: any) {
  if (isPartial) return new Text(theme.fg("warning", "WebMCP scanning..."), 0, 0);
  if (!expanded) return new Text("", 0, 0);
  return new Text(result.content?.find(c => c.type === "text")?.text ?? "", 0, 0);
}

function renderExecuteResult(result: { content?: Array<{ type: string; text?: string }>; details?: any }, { expanded, isPartial }: { expanded: boolean; isPartial: boolean }, theme: any) {
  if (isPartial) return new Text(theme.fg("warning", "WebMCP executing..."), 0, 0);

  if (!expanded) return new Text("", 0, 0);

  const text = result.content?.find(c => c.type === "text")?.text ?? JSON.stringify(result.details?.result?.response ?? result.details ?? {}, null, 2);
  return new Text(text, 0, 0);
}

const initializedDiscoveryMessages = new WeakSet<object>();

function renderDiscoveryMessage(message: { details?: { tools?: WebMcpTool[]; added?: WebMcpTool[]; removed?: WebMcpTool[] } }, { expanded }: { expanded: boolean }, theme: any) {
  const added = message.details?.added ?? message.details?.tools ?? [];
  const removed = message.details?.removed ?? [];
  const initialized = initializedDiscoveryMessages.has(message);
  if (!initialized) initializedDiscoveryMessages.add(message);
  const showDetails = initialized && expanded;

  const parts = [];
  if (added.length > 0) parts.push(`${added.length} new`);
  if (removed.length > 0) parts.push(`${removed.length} removed`);
  const summary = parts.length > 0 ? `WebMCP tools changed: ${parts.join(", ")}` : `WebMCP scanned: ${added.length} tool(s) found`;

  let text = theme.fg("toolTitle", theme.bold(summary));
  if (!showDetails) {
    text += ` ${theme.fg("dim", `(${keyHint("app.tools.expand", "to show tools")})`)}`;
    return new Text(text, 0, 0);
  }

  const sections = [];
  if (added.length > 0) sections.push(`New WebMCP tools:\n${listToolsText(added)}`);
  if (removed.length > 0) sections.push(`Removed WebMCP tools (no longer available):\n${listToolsText(removed)}`);
  text += `\n\n${sections.join("\n\n") || listToolsText(added)}`;
  return new Text(text, 0, 0);
}

function listToolsText(tools: WebMcpTool[]) {
  if (tools.length === 0) return "No WebMCP tools found. Use webmcp_list({ filter: \"optional filter\" }) to scan open Chrome tabs.";
  const byOrigin = new Map<string, WebMcpTool[]>();
  for (const tool of tools) {
    const group = byOrigin.get(tool.origin) ?? [];
    group.push(tool);
    byOrigin.set(tool.origin, group);
  }
  const groups: string[] = [];
  for (const [origin, originTools] of [...byOrigin.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const lines: string[] = [`${origin}:`];
    for (const tool of originTools.sort((a, b) => a.name.localeCompare(b.name))) {
      const id = toolId(tool);
      const name = id === tool.name ? id : `${id} (${tool.name})`;
      const parts = [`  - ${name}`];
      if (tool.title) parts.push(`@ ${tool.title}`);
      if (tool.description) parts.push(`\n    ${tool.description}`);
      lines.push(parts.join(" "));
    }
    groups.push(lines.join("\n\n"));
  }
  return groups.join("\n\n");
}

export default function webMcpExtension(pi: ExtensionAPI) {
  const registry = new Map<string, WebMcpTool>();
  let llmKnownTools = new Map<string, WebMcpTool>();
  let notifiedDiffSignature = "";
  let lastNotifiedDiff: { added: WebMcpTool[]; removed: WebMcpTool[] } | undefined;
  let monitoring = false;
  let pendingDiscoveryCheck: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeTerminalInput: (() => void) | undefined;
  let lastCtx: { isIdle(): boolean; hasPendingMessages(): boolean; ui: { notify(message: string, type?: "info" | "warning" | "error"): void; getToolsExpanded?(): boolean; onTerminalInput?(handler: (input: string) => { consume?: boolean; data?: string } | undefined): () => void } } | undefined;

  function toolDiff() {
    const currentKeys = new Set(registry.keys());
    const added = [...registry.entries()].filter(([key]) => !llmKnownTools.has(key)).map(([, tool]) => tool);
    const removed = [...llmKnownTools.entries()].filter(([key]) => !currentKeys.has(key)).map(([, tool]) => tool);
    return { added, removed };
  }

  function diffSignature(diff = toolDiff()) {
    return [
      ...diff.added.map(tool => `+${registryKey(tool)}`),
      ...diff.removed.map(tool => `-${registryKey(tool)}`),
    ].sort().join("\n");
  }

  function rememberLlmToolState() {
    llmKnownTools = new Map(registry);
    notifiedDiffSignature = "";
  }

  function removeToolsForTarget(targetId: string) {
    let changed = false;
    for (const [key, tool] of registry) {
      if (tool.targetId === targetId) {
        registry.delete(key);
        changed = true;
      }
    }
    if (changed) scheduleDiscoveryAnnouncement();
  }

  pi.on("session_start", async (_event, ctx) => {
    lastCtx = ctx;
    unsubscribeTerminalInput?.();
    unsubscribeTerminalInput = ctx.ui.onTerminalInput?.((input: string) => {
      if (!getKeybindings().matches(input, "app.tools.expand")) return undefined;
      setTimeout(() => {
        if (lastCtx && lastNotifiedDiff) notifyDiscoveryDiff(lastCtx, true);
      }, 0);
      return undefined;
    });
  });

  pi.on("session_shutdown", async () => {
    unsubscribeTerminalInput?.();
    unsubscribeTerminalInput = undefined;
    await disconnectBrowser();
  });

  pi.registerMessageRenderer?.("webmcp-discovery", renderDiscoveryMessage);

  function notifyDiscoveryDiff(ctx = lastCtx, force = false) {
    if (!ctx) return;
    const diff = force && lastNotifiedDiff ? lastNotifiedDiff : toolDiff();
    if (diff.added.length === 0 && diff.removed.length === 0) return;
    const signature = diffSignature(diff);
    if (!force && signature === notifiedDiffSignature) return;
    notifiedDiffSignature = signature;
    lastNotifiedDiff = diff;
    const parts = [];
    if (diff.added.length > 0) parts.push(`${diff.added.length} new`);
    if (diff.removed.length > 0) parts.push(`${diff.removed.length} removed`);
    const summary = `WebMCP tools changed: ${parts.join(", ")}`;
    if (!ctx.ui.getToolsExpanded?.()) {
      ctx.ui.notify(`${summary}. ${keyHint("app.tools.expand", "Show details")}. The next message will include updated tool context.`, "info");
      return;
    }
    const sections = [];
    if (diff.added.length > 0) sections.push(`New WebMCP tools:\n${listToolsText(diff.added)}`);
    if (diff.removed.length > 0) sections.push(`Removed WebMCP tools:\n${listToolsText(diff.removed)}`);
    ctx.ui.notify(`${summary}\n\n${sections.join("\n\n")}\n\nThe next message will include updated tool context.`, "info");
  }

  let lastScanNewCount = 0;

  function scheduleDiscoveryAnnouncement(ctx = lastCtx) {
    if (ctx) lastCtx = ctx;
    if (pendingDiscoveryCheck) return;
    pendingDiscoveryCheck = setTimeout(() => {
      pendingDiscoveryCheck = undefined;
      const currentCtx = ctx ?? lastCtx;
      if (currentCtx && (!currentCtx.isIdle() || currentCtx.hasPendingMessages())) {
        scheduleDiscoveryAnnouncement(currentCtx);
        return;
      }
      notifyDiscoveryDiff(currentCtx);
    }, 250);
  }

  async function attachMonitorTarget(target: TargetInfo) {
    targetInfoById.set(target.targetId, target);
    try {
      await getAttachedSession(await openBrowser(), target.targetId);
    } catch {
      // The tab may have closed between discovery and attach.
    }
  }

  async function startToolMonitor() {
    if (monitoring) return;
    monitoring = true;
    const cdp = await openBrowser();

    cdp.on("WebMCP.toolsAdded", (ev: any, evSessionId?: string) => {
      if (!evSessionId) return;
      const targetId = targetIdBySession.get(evSessionId);
      if (!targetId) return;
      const target = targetInfoById.get(targetId);
      if (!target) return;

      const newTools: WebMcpTool[] = [];
      for (const tool of ev.tools ?? []) {
        const webMcpTool = {
          targetId,
          title: target.title,
          url: target.url,
          origin: originName(target.url),
          ...tool,
        };
        if (!registry.has(registryKey(webMcpTool))) newTools.push(webMcpTool);
      }
      upsertTools(registry, newTools);
      scheduleDiscoveryAnnouncement();
    });

    cdp.on("WebMCP.toolsRemoved", (ev: any, evSessionId?: string) => {
      if (!evSessionId) return;
      const targetId = targetIdBySession.get(evSessionId);
      if (!targetId) return;
      const target = targetInfoById.get(targetId);
      if (!target) return;
      const removedNames = new Set((ev.tools ?? ev.toolNames ?? []).map((tool: any) => typeof tool === "string" ? tool : tool?.name));
      if (removedNames.size === 0) return;
      let changed = false;
      for (const [key, tool] of registry) {
        if (tool.targetId === targetId && removedNames.has(tool.name)) {
          registry.delete(key);
          changed = true;
        }
      }
      if (changed) scheduleDiscoveryAnnouncement();
    });

    cdp.on("Target.targetCreated", ({ targetInfo }: { targetInfo?: TargetInfo }) => {
      if (!targetInfo || targetInfo.type !== "page" || targetInfo.url.startsWith("chrome://") || targetInfo.url.startsWith("devtools://")) return;
      void attachMonitorTarget(targetInfo);
    });
    cdp.on("Target.targetInfoChanged", ({ targetInfo }: { targetInfo?: TargetInfo }) => {
      if (!targetInfo || targetInfo.type !== "page") return;
      const previous = targetInfoById.get(targetInfo.targetId);
      if (previous && previous.url !== targetInfo.url) removeToolsForTarget(targetInfo.targetId);
      targetInfoById.set(targetInfo.targetId, targetInfo);
    });
    cdp.on("Target.targetDestroyed", ({ targetId }: { targetId?: string }) => {
      if (!targetId) return;
      removeToolsForTarget(targetId);
      const sessionId = attachedSessions.get(targetId);
      if (sessionId) targetIdBySession.delete(sessionId);
      attachedSessions.delete(targetId);
      targetInfoById.delete(targetId);
    });
    await cdp.send("Target.setDiscoverTargets", { discover: true });
    await Promise.all((await getPageTargets(cdp)).map(attachMonitorTarget));
  }


  async function scanAndStore(filter = "", announce = false) {
    const tools = await scanWebMcpTools(filter);
    await startToolMonitor();
    const newTools = tools.filter(tool => !registry.has(registryKey(tool)));
    lastScanNewCount = newTools.length;
    upsertTools(registry, tools);
    if (announce) scheduleDiscoveryAnnouncement();
    else scheduleDiscoveryAnnouncement();
    return tools;
  }

  pi.on("agent_end", async (_event, ctx) => {
    lastCtx = ctx;
    scheduleDiscoveryAnnouncement(ctx);
  });

  pi.on("before_agent_start", async () => {
    const diff = toolDiff();
    if (diff.added.length === 0 && diff.removed.length === 0) return;
    rememberLlmToolState();
    const removedText = diff.removed.length > 0
      ? `\n\nRemoved WebMCP tools (no longer available):\n${listToolsText(diff.removed)}`
      : "";
    return {
      message: {
        customType: "webmcp-discovery",
        content: `WebMCP tool state changed since the LLM was last informed.\n\nNew WebMCP tools:\n\n${listToolsText(diff.added)}${removedText}\n\nUse webmcp_describe to inspect parameters and webmcp_execute with the listed origin to invoke an available tool.`,
        display: false,
        details: { added: diff.added, removed: diff.removed },
      },
    };
  });

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
    renderCall: renderListCall,
    renderResult: renderListResult,
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
    promptSnippet: "Inspect a WebMCP page tool schema before executing it; pass the origin from webmcp_list",
    promptGuidelines: [
      "Use webmcp_describe with both tool and origin from webmcp_list when you need a WebMCP tool's exact parameters before execution.",
    ],
    parameters: Type.Object({
      tool: Type.String({ description: "Tool id from webmcp_list, or the page-provided tool name." }),
      origin: Type.String({ description: "Origin/host where the tool is registered, without protocol (e.g. example.com)." }),
    }),
    renderCall: renderDescribeCall,
    renderResult: renderDescribeResult,
    async execute(_toolCallId: string, params: { tool: string; origin: string }) {
      if (registry.size === 0) await scanAndStore("");
      const resolved = resolveTool(params.tool, params.origin);
      if ("candidates" in resolved) {
        return { content: [{ type: "text" as const, text: resolved.candidates.length ? `Ambiguous tool. Provide origin.\n\n${listToolsText(resolved.candidates)}` : `Tool not found: ${params.tool}. Try webmcp_list first.` }], details: { candidates: resolved.candidates } };
      }
      const id = toolId(resolved);
      const text = `${resolved.description ?? "(no description)"}\n\nParameters:\n${formatSchema(resolved.inputSchema)}`;
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
    renderCall: renderExecuteCall,
    renderResult: renderExecuteResult,
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
      const text = `\nInput:\n${JSON.stringify(input, null, 2)}\n\nResponse:\n${JSON.stringify(result.response, null, 2)}`;
      return {
        content: [{ type: "text" as const, text }],
        details: { id: toolId(resolved), origin: resolved.origin, tool: resolved, input, result },
      };
    },
  });

  pi.registerTool({
    name: "webmcp_disconnect",
    label: "WebMCP Disconnect",
    description: "Disconnect from Chrome remote debugging and clear known WebMCP tools.",
    parameters: Type.Object({}),
    async execute() {
      await disconnectBrowser();
      registry.clear();
      return { content: [{ type: "text" as const, text: "WebMCP disconnected and registry cleared." }], details: {} };
    },
  });

  pi.registerCommand("webmcp", {
    description: "Connect to or disconnect from Chrome WebMCP tools",
    getArgumentCompletions: (prefix: string) => {
      const trimmed = prefix.trimStart();
      if (trimmed.includes(" ")) return null;

      const commands = [
        { value: "connect", label: "connect", detail: "Scan Chrome WebMCP tools" },
        { value: "disconnect", label: "disconnect", detail: "Disconnect from Chrome WebMCP" },
      ];
      const filtered = commands.filter(command => command.value.startsWith(trimmed));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const [subcommand = "connect", ...rest] = args.trim().split(/\s+/).filter(Boolean);
      const normalized = subcommand.toLowerCase();

      if (normalized === "disconnect") {
        await disconnectBrowser();
        registry.clear();
        ctx.ui.notify("WebMCP disconnected from Chrome.", "info");
        return;
      }

      if (normalized !== "connect") {
        ctx.ui.notify("Usage: /webmcp [connect|disconnect]", "error");
        return;
      }

      try {
        lastCtx = ctx;
        const tools = await scanAndStore(rest.join(" "), true);
        notifyDiscoveryDiff(ctx);
        if (lastScanNewCount === 0) ctx.ui.notify(`WebMCP scanned: ${tools.length} tool(s) found`, "info");
      } catch (err: any) {
        ctx.ui.notify(`WebMCP scan failed: ${err.message ?? err}`, "error");
      }
    },
  });
}
