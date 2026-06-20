import type { Theme } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export type PiWebMcpRenderCallOptions = {
  readonly toolName: string;
  readonly origin?: string;
  readonly webMcpTool?: string;
  readonly detail?: string;
};

export const renderPiWebMcpCall = (
  theme: Theme,
  { toolName, origin, webMcpTool, detail }: PiWebMcpRenderCallOptions,
): Text => {
  let text = theme.fg("toolTitle", theme.bold(toolName));

  if (origin) {
    text += ` ${theme.fg("accent", origin)}`;
  }

  if (webMcpTool) {
    text += ` ${theme.fg("dim", "→")} ${theme.fg("toolOutput", webMcpTool)}`;
  }

  if (detail) {
    text += ` ${theme.fg("dim", detail)}`;
  }

  return new Text(text, 0, 0);
};
