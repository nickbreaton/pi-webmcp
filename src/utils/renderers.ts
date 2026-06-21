import { getMarkdownTheme, keyText, type AgentToolResult, type Theme, type ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import type { Origin, ToolId } from "../schemas/WebMcpTool";

export type PiWebMcpRenderCallOptions = {
  readonly toolName: string;
  readonly origin?: Origin;
  readonly webMcpTool?: ToolId;
  readonly target?: string;
};

export const renderPiWebMcpCall = (
  theme: Theme,
  { toolName, origin, webMcpTool, target }: PiWebMcpRenderCallOptions,
) => {
  let text = theme.fg("toolTitle", theme.bold(toolName));

  if (target) {
    text += ` ${theme.fg("toolOutput", target)}`;
    text += ` ${theme.fg("dim", `(${keyText("app.tools.expand")} to expand)`)}`;
    return new Text(text, 0, 0);
  }

  if (!origin) {
    text += ` ${theme.fg("dim", `(${keyText("app.tools.expand")} to expand)`)}`;
    return new Text(text, 0, 0);
  }

  text += ` ${theme.fg("accent", origin)}`;

  if (webMcpTool) {
    text += ` ${theme.fg("dim", ":")} ${theme.fg("toolOutput", webMcpTool)}`;
  }

  text += ` ${theme.fg("dim", `(${keyText("app.tools.expand")} to expand)`)}`;

  return new Text(text, 0, 0);
};

const getTextResult = (result: AgentToolResult<unknown>): string => {
  return result.content?.find(c => c.type === "text")?.text ?? "";
};

export const renderPiWebMcpResult = (
  result: AgentToolResult<unknown>,
  { expanded }: ToolRenderResultOptions,
): Text => {
  if (!expanded) return new Text("", 0, 0);
  return new Text(getTextResult(result), 0, 0);
};

export const renderPiWebMcpMarkdownResult = (
  result: AgentToolResult<unknown>,
  { expanded }: ToolRenderResultOptions,
) => {
  if (!expanded) return new Text("", 0, 0);
  return new Markdown(getTextResult(result), 0, 0, getMarkdownTheme());
};

export const renderPiWebMcpServeResult = (
  result: AgentToolResult<unknown>,
  { expanded }: ToolRenderResultOptions,
): Text => {
  if (!expanded) return new Text("", 0, 0);
  return new Text(`\n${getTextResult(result)}`, 0, 0);
};

export const renderPiWebMcpListMessage = (message: { readonly content: unknown }) => {
  return new Markdown(typeof message.content === "string" ? message.content : "", 0, 0, getMarkdownTheme());
};
