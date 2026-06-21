import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
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
