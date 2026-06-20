import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { NodeHttpServer } from "@effect/platform-node";
import { Layer, ManagedRuntime, Schema } from "effect";
import { memoize } from "micro-memoize";
import { Type } from "typebox";
import { BrowserClient } from "./services/BrowserClient";
import { PiApi, PiContext } from "./services/PiApi";
import { PiWebMcpCommandService } from "./services/PiWebMcpCommandService";
import { PiWebMcpDescribeService } from "./services/PiWebMcpDescribeService";
import { PiWebMcpExecuteService } from "./services/PiWebMcpExecuteService";
import { PiWebMcpListService } from "./services/PiWebMcpListService";
import { PiWebMcpResponseService } from "./services/PiWebMcpResponseService";
import { PiWebMcpServeService, type PiWebMcpServeParams } from "./services/PiWebMcpServeService";
import { PiWebMcpSystemPromptService } from "./services/PiWebMcpSystemPromptService";
import { PiWebMcpToolStateService } from "./services/PiWebMcpToolStateService";
import { PiTurnRefService } from "./services/PiTurnRefService";
import { WebMcpToolDiffService } from "./services/WebMcpToolDiffService";
import { WebMcpToolsService } from "./services/WebMcpToolsService";
import { renderPiWebMcpCall, renderPiWebMcpListMessage, renderPiWebMcpMarkdownResult, renderPiWebMcpResult } from "./utils/renderers";
import { WebMcpTools } from "./schemas/WebMcpTool";

const init = memoize((pi: ExtensionAPI, ctx: ExtensionCommandContext) => {
  let currentContext = ctx;
  const piContext = new Proxy({} as ExtensionCommandContext, {
    get: (_, property) => currentContext[property as keyof ExtensionCommandContext],
  });

  const live = PiWebMcpCommandService.liveWithoutDependencies.pipe(
    Layer.provideMerge(PiWebMcpDescribeService.live),
    Layer.provideMerge(PiWebMcpExecuteService.live),
    Layer.provideMerge(PiWebMcpListService.live),
    Layer.provideMerge(PiWebMcpResponseService.live),
    Layer.provideMerge(PiWebMcpServeService.live),
    Layer.provideMerge(PiWebMcpSystemPromptService.live),
    Layer.provideMerge(PiWebMcpToolStateService.live),
    Layer.provideMerge(PiTurnRefService.live),
    Layer.provideMerge(WebMcpToolDiffService.live),
    Layer.provideMerge(WebMcpToolsService.live),
    Layer.provideMerge(Layer.mergeAll(
      Layer.succeed(PiApi, pi),
      Layer.succeed(PiContext, piContext),
      BrowserClient.live,
      NodeHttpServer.layerHttpServices,
    )),
  );

  const runtime = ManagedRuntime.make(live);

  pi.registerMessageRenderer("webmcp-list", renderPiWebMcpListMessage);

  pi.registerTool({
    name: "webmcp_execute",
    label: "WebMCP Execute",
    description: "Execute a WebMCP tool exposed by an open Chrome tab.",
    promptSnippet: "Execute a selected WebMCP page tool with JSON arguments",
    promptGuidelines: [
      "Before using webmcp_execute, ask the user to run /webmcp if WebMCP is not connected or no matching tool is known.",
      "When calling webmcp_execute, pass the page-provided tool name or the safe tool id, and always include the origin from webmcp_list.",
    ],
    parameters: Type.Object({
      tool: Type.String({ description: "Tool id or page-provided WebMCP tool name." }),
      origin: Type.String({ description: "Origin/host where the tool is registered, without protocol (e.g. example.com)." }),
      args: Type.Optional(Type.String({ description: "Arguments as a JSON object string for the WebMCP tool." })),
    }),
    renderCall: (args, theme) => renderPiWebMcpCall(theme, {
      toolName: "webmcp_execute",
      origin: args.origin,
      webMcpTool: args.tool,
    }),
    renderResult: renderPiWebMcpResult,
    async execute(_toolCallId, params) {
      return runtime.runPromise(PiWebMcpExecuteService.use(service => service.execute(params)));
    },
  });

  pi.registerTool({
    name: "webmcp_list",
    label: "WebMCP List",
    description: "List the WebMCP tools currently known to the session, grouped by origin. Does not scan the browser.",
    promptSnippet: "List WebMCP tools currently known to the session, grouped by origin",
    promptGuidelines: [
      "The available WebMCP tools are already injected into your system prompt each turn; keep a running internal ledger of them and prefer it over calling webmcp_list.",
      "Only call webmcp_list when you are genuinely confused about which tools are available or need the full grouped listing again; it does not trigger a new browser scan.",
    ],
    parameters: Type.Object({
      filter: Type.Optional(Type.String({ description: "Optional URL/title/target/origin filter to narrow the listed tools." })),
      refresh: Type.Optional(Type.Boolean({ description: "Reserved; the session does not actively scan the browser on call." })),
    }),
    renderCall: (_, theme) => renderPiWebMcpCall(theme, {
      toolName: "webmcp_list",
    }),
    renderResult: renderPiWebMcpMarkdownResult,
    async execute(_, params) {
      return runtime.runPromise(PiWebMcpListService.use(service => service.execute(params)));
    },
  });

  pi.registerTool({
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
    renderCall: (args, theme) => renderPiWebMcpCall(theme, {
      toolName: "webmcp_describe",
      origin: args.origin,
      webMcpTool: args.tool,
    }),
    renderResult: renderPiWebMcpResult,
    async execute(_, params) {
      return runtime.runPromise(PiWebMcpDescribeService.use(service => service.execute(params)));
    },
  });

  pi.on('turn_end', async () => {
    await runtime.runPromise(PiTurnRefService.use(service => service.reset()))
  });

  pi.on('before_agent_start', async (event, ctx) => {
    ctx.ui.setWidget("webmcp-list", undefined);

    const prompt = await runtime.runPromise(PiWebMcpSystemPromptService.use(service => service.getSystemPrompt()));

    if (!prompt) return;

    return {
      systemPrompt: event.systemPrompt + `\n\n${prompt}`,
    };
  });

  pi.on("message_end", async (event) => {
    if (event.message.role !== "user") return;

    const tools = await runtime.runPromise(PiWebMcpToolStateService.use(service => service.commit));
    const messageWithDetails = event.message as typeof event.message & { details?: Record<string, unknown> };

    return {
      message: {
        ...event.message,
        details: {
          ...messageWithDetails.details,
          webmcp: { tools: JSON.parse(JSON.stringify(Schema.encodeSync(WebMcpTools)(tools))) },
        },
      },
    };
  });

  pi.on('agent_end', async () => {
    await runtime.runPromise(PiWebMcpCommandService.use(service => service.nudge()));
  });

  pi.on('session_tree', async () => {
    await runtime.runPromise(PiWebMcpCommandService.use(service => service.nudge()));
  });

  pi.on("session_shutdown", async () => {
    await runtime.dispose();
  });

  return {
    runtime,
    setContext: (ctx: ExtensionCommandContext) => {
      currentContext = ctx;
    },
  };
}, { transformKey: () => ["pi-webmcp-runtime"] });

export async function handle(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
  const { runtime, setContext } = init(pi, ctx);
  setContext(ctx);

  const effect = PiWebMcpCommandService.use(service => {
    return service.handle(args);
  });

  await runtime.runPromise(effect);
}

export async function serve(pi: ExtensionAPI, params: PiWebMcpServeParams, ctx: ExtensionContext) {
  const commandContext = ctx as ExtensionCommandContext;
  const { runtime, setContext } = init(pi, commandContext);
  setContext(commandContext);

  return runtime.runPromise(PiWebMcpServeService.use(service => service.execute(params)));
}
