import { Hash, Schema } from "effect";

export class WebMcpToolAnnotation extends Schema.Class<WebMcpToolAnnotation>("WebMcpToolAnnotation")({
  readOnly: Schema.optionalKey(Schema.Boolean),
  untrustedContent: Schema.optionalKey(Schema.Boolean),
  autosubmit: Schema.optionalKey(Schema.Boolean),
}) { }

export class WebMcpToolMetadata extends Schema.Class<WebMcpToolMetadata>("WebMcpToolMetadata")({
  targetId: Schema.String,
  title: Schema.String,
  url: Schema.String,
}) { }

export class Origin extends Schema.asClass(Schema.String.pipe(Schema.brand("Origin"))) { }

export class ToolId extends Schema.asClass(Schema.String.pipe(Schema.brand("ToolId"))) { }

export class WebMcpTool extends Schema.Class<WebMcpTool>("WebMcpTool")({
  name: Schema.String,
  origin: Origin,
  sessionId: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  inputSchema: Schema.optionalKey(Schema.Json),
  outputSchema: Schema.optionalKey(Schema.Json),
  annotations: Schema.optionalKey(WebMcpToolAnnotation),
  frameId: Schema.String,
  backendNodeId: Schema.optionalKey(Schema.Number),
  stackTrace: Schema.optionalKey(Schema.Unknown),
}) {
  get id(): ToolId {
    const transformed = this.name.toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48);
    return Schema.decodeSync(ToolId)(transformed);
  }

  get hash(): number {
    return Hash.hash({
      name: this.name,
      origin: this.origin,
      description: this.description,
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
      annotations: this.annotations,
    });
  }
}

export class WebMcpToolContainer extends Schema.Class<WebMcpToolContainer>("WebMcpToolContainer")({
  metadata: WebMcpToolMetadata,
  tool: WebMcpTool,
}) { }

export const WebMcpTools = Schema.Array(WebMcpTool);
export const WebMcpToolContainers = Schema.Array(WebMcpToolContainer);
