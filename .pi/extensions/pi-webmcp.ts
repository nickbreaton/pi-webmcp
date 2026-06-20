import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { renderPiWebMcpCall, renderPiWebMcpServeResult } from "../../src/utils/renderers";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "webmcp_serve",
    label: "WebMCP Serve",
    description: "Serve a local file or folder over HTTP so WebMCP pages can reference it.",
    promptSnippet: "Serve a local file or folder and return a browser-accessible URL",
    promptGuidelines: [
      "Use webmcp_serve when a WebMCP page needs to fetch or embed a local file or folder from this session.",
      "Pass a file or directory path. Relative paths resolve from the current Pi working directory.",
      "The returned URL remains available for the normal Pi application lifecycle.",
    ],
    parameters: Type.Object({
      path: Type.String({ description: "File or directory path to serve. Relative paths resolve from the current Pi working directory." }),
    }),
    renderCall: (args, theme) => renderPiWebMcpCall(theme, {
      toolName: "webmcp_serve",
      target: args.path,
    }),
    renderResult: renderPiWebMcpServeResult,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { serve } = await import("../../src/main");
      return serve(pi, params, ctx);
    },
  });

  pi.registerCommand("webmcp", {
    description: "Connect to or disconnect from Chrome WebMCP tools",
    getArgumentCompletions: (prefix) => {
      const completions = [
        { value: "connect", label: "connect", detail: "Scan Chrome WebMCP tools" },
        { value: "disconnect", label: "disconnect", detail: "Disconnect from Chrome WebMCP" },
        { value: "list", label: "list", detail: "Show active WebMCP tools above the composer" },
      ];
      const filtered = completions.filter(({ value }) => value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const { handle } = await import("../../src/main");
      await handle(pi, args, ctx);
    },
  });
}
