import { keyHint, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Effect, Layer, ManagedRuntime } from "effect";
import { memoize } from "micro-memoize";
import { Type } from "typebox";
import { BrowserClient } from "./services/BrowserClient";
import { PiContext } from "./services/PiApi";
import { PiWebMcpCommandService } from "./services/PiWebMcpCommandService";
import { PiWebMcpDescribeService } from "./services/PiWebMcpDescribeService";
import { PiWebMcpExecuteService } from "./services/PiWebMcpExecuteService";
import { PiWebMcpListService } from "./services/PiWebMcpListService";
import { PiWebMcpResponseService } from "./services/PiWebMcpResponseService";
import { PiWebMcpToolStateService } from "./services/PiWebMcpToolStateService";
import { WebMcpToolDiffService } from "./services/WebMcpToolDiffService";
import { WebMcpToolsService } from "./services/WebMcpToolsService";
import { Text } from "@earendil-works/pi-tui";

const init = memoize((pi: ExtensionAPI, ctx: ExtensionCommandContext) => {
  const live = PiWebMcpCommandService.liveWithoutDependencies.pipe(
    Layer.provideMerge(PiWebMcpDescribeService.live),
    Layer.provideMerge(PiWebMcpExecuteService.live),
    Layer.provideMerge(PiWebMcpListService.live),
    Layer.provideMerge(PiWebMcpResponseService.live),
    Layer.provideMerge(PiWebMcpToolStateService.live),
    Layer.provideMerge(WebMcpToolDiffService.live),
    Layer.provideMerge(WebMcpToolsService.live),
    Layer.provideMerge(Layer.mergeAll(
      Layer.succeed(PiContext, ctx),
      BrowserClient.live,
    )),
  );

  const runtime = ManagedRuntime.make(live);

  pi.registerTool({
    name: "webmcp_execute",
    label: "WebMCP Execute",
    description: "Execute a WebMCP tool exposed by an open Chrome tab.",
    promptSnippet: "Execute a selected WebMCP page tool with JSON arguments",
    promptGuidelines: [
      "Before using webmcp_execute, ask the user to run /webmcp connect if WebMCP is not connected or no matching tool is known.",
      "When calling webmcp_execute, pass the page-provided tool name or the safe tool id, and include origin when needed to disambiguate same-named tools.",
    ],
    parameters: Type.Object({
      tool: Type.String({ description: "Tool id or page-provided WebMCP tool name." }),
      origin: Type.Optional(Type.String({ description: "Origin/host where the tool is registered, used to disambiguate same-named tools." })),
      args: Type.Optional(Type.String({ description: "Arguments as a JSON object string for the WebMCP tool." })),
    }),
    async execute(_toolCallId, params) {
      return runtime.runPromise(PiWebMcpExecuteService.use(service => service.execute(params)));
    },
  });

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
    renderCall: (_, theme) => {
      return new Text(`${theme.fg("toolTitle", theme.bold("webmcp_list"))} ${theme.fg("dim", `(${keyHint("app.tools.expand", "to show tools")})`)}`, 0, 0);
    },
    renderResult: (result, { expanded, isPartial }, theme) => {
      if (isPartial) return new Text(theme.fg("warning", "WebMCP scanning..."), 0, 0);
      if (!expanded) return new Text("", 0, 0);
      return new Text(result.content?.find(c => c.type === "text")?.text ?? "", 0, 0);
    },
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
    renderCall: (args, theme) => {
      const origin = args.origin ? theme.fg("accent", args.origin) : theme.fg("dim", "unknown origin");
      const tool = args.tool ? theme.fg("toolOutput", args.tool) : theme.fg("dim", "unknown tool");
      return new Text(`${theme.fg("toolTitle", theme.bold("webmcp_describe"))} ${origin} ${theme.fg("dim", "→")} ${tool}`, 0, 0);
    },
    renderResult: () => new Text("", 0, 0),
    async execute(_, params) {
      return runtime.runPromise(PiWebMcpDescribeService.use(service => service.execute(params)));
    },
  });

  //   pi.registerTool({
  //     name: "webmcp_disconnect",
  //     label: "WebMCP Disconnect",
  //     description: "Disconnect from Chrome remote debugging and clear known WebMCP tools.",
  //     parameters: Type.Object({}),
  //     async execute() {
  //       const cdp = Option.getOrUndefined(await runtime.runPromise(BrowserClient.use(browser => browser.get)));
  //       if (cdp) await detachSessions(cdp);
  //       await runtime.runPromise(BrowserClient.use(browser => browser.disconnect()));
  //       monitoring = false;
  //       registry.clear();
  //       registryCurrent = false;
  //       return { content: [{ type: "text" as const, text: "WebMCP disconnected and registry cleared." }], details: {} };
  //     },
  //   });

  pi.on('before_agent_start', async (event) => {
    const tools = await runtime.runPromise(PiWebMcpToolStateService.use(service => service.staged));

    return {
      systemPrompt: event.systemPrompt + `\n\nAvailable WebMCP tools: ${tools.map(tool => tool.name).join(', ')}`,
    }
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
          webmcp: { tools },
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

  return runtime;
});

export async function handle(pi: ExtensionAPI, args: string, ctx: ExtensionCommandContext) {
  const runtime = init(pi, ctx);

  const effect = PiWebMcpCommandService.use(service => {
    return service.handle(args);
  });

  await runtime.runPromise(effect);
}
