import { Schema } from "effect";

export class WebMcpToolAnnotation extends Schema.Class<WebMcpToolAnnotation>("WebMcpToolAnnotation")({
  readOnly: Schema.optionalKey(Schema.Boolean),
  untrustedContent: Schema.optionalKey(Schema.Boolean),
  autosubmit: Schema.optionalKey(Schema.Boolean),
}) {}

export class WebMcpToolMetadata extends Schema.Class<WebMcpToolMetadata>("WebMcpToolMetadata")({
  targetId: Schema.String,
  title: Schema.String,
  url: Schema.String,
}) {}

export class WebMcpTool extends Schema.Class<WebMcpTool>("WebMcpTool")({
  name: Schema.String,
  description: Schema.String,
  inputSchema: Schema.Unknown,
  annotations: Schema.optionalKey(WebMcpToolAnnotation),
  frameId: Schema.String,
  backendNodeId: Schema.optionalKey(Schema.Number),
  stackTrace: Schema.optionalKey(Schema.Unknown),
}) {}

export class WebMcpToolContainer extends Schema.Class<WebMcpToolContainer>("WebMcpToolContainer")({
  metadata: WebMcpToolMetadata,
  tool: WebMcpTool,
}) {}

export const WebMcpToolContainers = Schema.Array(WebMcpToolContainer);
