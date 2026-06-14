import { Schema } from "effect";

export const WebMcpToolAnnotation = Schema.Struct({
  readOnly: Schema.optionalKey(Schema.Boolean),
  untrustedContent: Schema.optionalKey(Schema.Boolean),
  autosubmit: Schema.optionalKey(Schema.Boolean),
});

export const WebMcpToolMetadata = Schema.Struct({
  targetId: Schema.String,
  title: Schema.String,
  url: Schema.String,
});

export const WebMcpTool = Schema.Struct({
  name: Schema.String,
  description: Schema.String,
  inputSchema: Schema.Unknown,
  annotations: Schema.optionalKey(WebMcpToolAnnotation),
  frameId: Schema.String,
  backendNodeId: Schema.optionalKey(Schema.Number),
  stackTrace: Schema.optionalKey(Schema.Unknown),
});

export const WebMcpToolContainer = Schema.Struct({
  metadata: WebMcpToolMetadata,
  tool: WebMcpTool,
});

export const WebMcpToolContainers = Schema.Array(WebMcpToolContainer);

export type WebMcpToolMetadata = typeof WebMcpToolMetadata.Type;
export type WebMcpTool = typeof WebMcpTool.Type;
export type WebMcpToolContainer = typeof WebMcpToolContainer.Type;
