import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Effect, Layer, ManagedRuntime } from "effect";
import { memoize } from "micro-memoize";
import { BrowserClient } from "./services/BrowserClient";
import { PiContext } from "./services/PiApi";
import { PiWebMcpCommandService } from "./services/PiWebMcpCommandService";
import { PiWebMcpToolStateService } from "./services/PiWebMcpToolStateService";
import { WebMcpToolsService } from "./services/WebMcpToolsService";

const init = memoize((pi: ExtensionAPI, ctx: ExtensionCommandContext) => {
  const live = PiWebMcpCommandService.liveWithoutDependencies.pipe(
    Layer.provideMerge(PiWebMcpToolStateService.live),
    Layer.provideMerge(WebMcpToolsService.live),
    Layer.provideMerge(Layer.mergeAll(
      Layer.succeed(PiContext, ctx),
      BrowserClient.live,
    )),
  );

  const runtime = ManagedRuntime.make(live);

  // TODO: Re-introduce Pi-facing dynamic tool registration after the Effect services
  // own discovery, invocation, and turn-boundary commits end-to-end.

  // Legacy Pi tool registrations kept here as a reference while dynamic tool registration
  // is rebuilt on top of the Effect services. Do not uncomment wholesale; the old
  // implementations depended on deleted scan/registry helpers.
  //   pi.registerTool({
  //     name: "webmcp_list",
  //     label: "WebMCP List",
  //     description: "Scan open Chrome tabs for WebMCP tools and list known tools grouped by origin.",
  //     promptSnippet: "List WebMCP tools exposed by open browser tabs, grouped by origin",
  //     promptGuidelines: [
  //       "For user requests that may involve an open browser page or page-specific action, call webmcp_list before saying no page tool is available.",
  //       "Use webmcp_list to get each tool's id, name, origin, and description before calling webmcp_describe or webmcp_execute.",
  //     ],
  //     parameters: Type.Object({
  //       filter: Type.Optional(Type.String({ description: "Optional URL/title/target/origin filter for scanning open tabs." })),
  //       refresh: Type.Optional(Type.Boolean({ description: "Force a new scan even if tools are already known. Default: true." })),
  //     }),
  //     renderCall: renderListCall,
  //     renderResult: renderListResult,
  //     async execute(_toolCallId, params) {
  //       if (Option.isNone(await runtime.runPromise(BrowserClient.use(browser => browser.get)))) return { content: [{ type: "text" as const, text: webMcpConnectInstruction() }], details: { connected: false, tools: [] as WebMcpTool[] } };
  //       if (params.refresh !== false || registry.size === 0) await scanAndStore(params.filter ?? "", true);
  //       const tools = [...registry.values()].filter(t =>
  //         !params.filter || t.url.includes(params.filter) || t.title?.includes(params.filter) || t.origin.includes(params.filter) || t.targetId === params.filter
  //       );
  //       return { content: [{ type: "text" as const, text: listToolsText(tools) }], details: { connected: true, tools } };
  //     },
  //   });
  //
  //   pi.registerTool({
  //     name: "webmcp_describe",
  //     label: "WebMCP Describe",
  //     description: "Describe a WebMCP tool's page, origin, description, and input parameters.",
  //     promptSnippet: "Inspect a WebMCP page tool schema before executing it; pass the origin from webmcp_list",
  //     promptGuidelines: [
  //       "Use webmcp_describe with both tool and origin from webmcp_list when you need a WebMCP tool's exact parameters before execution.",
  //     ],
  //     parameters: Type.Object({
  //       tool: Type.String({ description: "Tool id from webmcp_list, or the page-provided tool name." }),
  //       origin: Type.String({ description: "Origin/host where the tool is registered, without protocol (e.g. example.com)." }),
  //     }),
  //     renderCall: renderDescribeCall,
  //     renderResult: renderDescribeResult,
  //     async execute(_toolCallId: string, params: { tool: string; origin: string }): Promise<AgentToolResult<WebMcpDescribeDetails>> {
  //       if (Option.isNone(await runtime.runPromise(BrowserClient.use(browser => browser.get)))) return { content: [{ type: "text" as const, text: webMcpConnectInstruction() }], details: { connected: false } };
  //       if (registry.size === 0) await scanAndStore("");
  //       const resolved = resolveTool(params.tool, params.origin);
  //       if ("candidates" in resolved) {
  //         return { content: [{ type: "text" as const, text: resolved.candidates.length ? `Ambiguous tool.Provide origin.\n\n${listToolsText(resolved.candidates)} ` : `Tool not found: ${params.tool}. Try webmcp_list first.` }], details: { candidates: resolved.candidates } };
  //       }
  //       const id = toolId(resolved);
  //       const text = `${resolved.description ?? "(no description)"} \n\nParameters: \n${formatSchema(resolved.inputSchema)} `;
  //       return { content: [{ type: "text" as const, text }], details: { tool: resolved, id } };
  //     },
  //   });
  //
  //   pi.registerTool({
  //     name: "webmcp_execute",
  //     label: "WebMCP Execute",
  //     description: "Execute a WebMCP tool exposed by an open Chrome tab.",
  //     promptSnippet: "Execute a selected WebMCP page tool with JSON arguments",
  //     promptGuidelines: [
  //       "Before using webmcp_execute, use webmcp_list and usually webmcp_describe to identify the correct tool and parameters.",
  //       "When calling webmcp_execute, pass both tool and origin from webmcp_list to disambiguate same-named tools on different sites.",
  //     ],
  //     parameters: Type.Object({
  //       tool: Type.String({ description: "Tool id from webmcp_list, or the page-provided tool name." }),
  //       origin: Type.String({ description: "Origin/host where the tool is registered, without protocol (e.g. example.com)." }),
  //       args: Type.Optional(Type.String({ description: "Arguments as a JSON object string for the WebMCP tool." })),
  //     }),
  //     renderCall: renderExecuteCall,
  //     renderResult: renderExecuteResult,
  //     async execute(_toolCallId: string, params: { tool: string; origin: string; args?: string }): Promise<AgentToolResult<WebMcpExecuteDetails>> {
  //       if (Option.isNone(await runtime.runPromise(BrowserClient.use(browser => browser.get)))) return { content: [{ type: "text" as const, text: webMcpConnectInstruction() }], details: { connected: false } };
  //       if (registry.size === 0) await scanAndStore("");
  //       const resolved = resolveTool(params.tool, params.origin);
  //       if ("candidates" in resolved) {
  //         return { content: [{ type: "text" as const, text: resolved.candidates.length ? `Ambiguous tool.Retry with origin.\n\n${listToolsText(resolved.candidates)} ` : `Tool not found: ${params.tool}. Try webmcp_list first.` }], details: { candidates: resolved.candidates, error: "tool_not_found_or_ambiguous" } };
  //       }
  //       let input: Record<string, unknown> = {};
  //       if (params.args) {
  //         input = JSON.parse(params.args);
  //         if (typeof input !== "object" || input === null || Array.isArray(input)) throw new Error("args must be a JSON object string");
  //       }
  //       const cdp = Option.getOrUndefined(await runtime.runPromise(BrowserClient.use(browser => browser.get)));
  //       if (!cdp) return { content: [{ type: "text" as const, text: webMcpConnectInstruction() }], details: { connected: false } };
  //       const result = await invokeWebMcpTool(cdp, resolved, input);
  //       const text = `\nInput: \n${JSON.stringify(input, null, 2)} \n\nResponse: \n${JSON.stringify(result.response, null, 2)} `;
  //       return {
  //         content: [{ type: "text" as const, text }],
  //         details: { id: toolId(resolved), origin: resolved.origin, tool: resolved, input, result },
  //       };
  //     },
  //   });
  //
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
