import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
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
    const parsed = new URL(url);
    return safeName(parsed.host);
  } catch {
    return safeName(url.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").split("/")[0]);
  }
}

function toolSchema(schema: any) {
  // WebMCP schemas are JSON Schema-shaped and generally compatible enough for pi's TypeBox validator.
  return schema && typeof schema === "object" ? schema : Type.Object({}, { additionalProperties: true });
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
    cdp.on("WebMCP.toolsAdded", (ev: any, evSessionId?: string) => {
      if (evSessionId !== sessionId) return;
      for (const tool of ev.tools ?? []) {
        found.push({ targetId: target.targetId, title: target.title, url: target.url, ...tool });
      }
    });
    await cdp.send("WebMCP.enable", {}, sessionId);
    await new Promise(resolve => setTimeout(resolve, 500));
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

export default function webMcpExtension(pi: ExtensionAPI) {
  const registered = new Set<string>();
  const registry = new Map<string, WebMcpTool>();

  pi.on("session_shutdown", async () => {
    await disconnectBrowser();
  });

  async function registerDiscovered(filter = "", notify?: (msg: string) => void) {
    const tools = await scanWebMcpTools(filter);
    for (const tool of tools) {
      const base = `${originName(tool.url)}__${safeName(tool.name)}`;
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

  pi.registerCommand("webmcp-connect", {
    description: "Connect to Chrome WebMCP and register available page tools",
    handler: async (args, ctx) => {
      try {
        const tools = await registerDiscovered(args.trim(), msg => ctx.ui.notify(msg, "info"));
        ctx.ui.notify(`WebMCP connected: ${tools.length} tool(s).`, "info");
      } catch (err: any) {
        ctx.ui.notify(`WebMCP connect failed: ${err.message ?? err}`, "error");
      }
    },
  });

  pi.registerCommand("webmcp-disconnect", {
    description: "Disconnect pi from Chrome's remote debugging session",
    handler: async (_args, ctx) => {
      await disconnectBrowser();
      ctx.ui.notify("WebMCP disconnected from Chrome.", "info");
    },
  });
}
