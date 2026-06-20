import { keyText, type AgentToolResult, type Theme, type ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export type PiWebMcpRenderCallOptions = {
  readonly toolName: string;
  readonly origin?: string;
  readonly webMcpTool?: string;
  readonly arrow?: boolean;
  readonly detail?: string;
};

export const renderPiWebMcpCall = (
  theme: Theme,
  { toolName, origin, webMcpTool, arrow = false, detail }: PiWebMcpRenderCallOptions,
): Text => {
  let text = theme.fg("toolTitle", theme.bold(toolName));

  if (origin) {
    text += ` ${theme.fg("accent", origin)}`;
  }

  if (webMcpTool) {
    text += arrow
      ? ` ${theme.fg("dim", "→")} ${theme.fg("toolOutput", webMcpTool)}`
      : ` ${theme.fg("toolOutput", webMcpTool)}`;
  }

  if (detail) {
    text += ` ${theme.fg("dim", detail)}`;
  }

  text += ` ${theme.fg("dim", `(${keyText("app.tools.expand")} to expand)`)}`;

  return new Text(text, 0, 0);
};

export const renderPiWebMcpResult = (
  result: AgentToolResult<unknown>,
  { expanded }: ToolRenderResultOptions,
): Text => {
  if (!expanded) return new Text("", 0, 0);
  return new Text(result.content?.find(c => c.type === "text")?.text ?? "", 0, 0);
};
