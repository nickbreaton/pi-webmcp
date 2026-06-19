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

export class WebMcpTool extends Schema.Class<WebMcpTool>("WebMcpTool")({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  inputSchema: Schema.optionalKey(Schema.Unknown),
  outputSchema: Schema.optionalKey(Schema.Unknown),
  annotations: Schema.optionalKey(WebMcpToolAnnotation),
  frameId: Schema.String,
  backendNodeId: Schema.optionalKey(Schema.Number),
  stackTrace: Schema.optionalKey(Schema.Unknown),
}) {
  /**
   * Stable identity key for diffing. Hashes the tool's identity fields and
   * intentionally excludes browser-side location fields (`frameId`,
   * `backendNodeId`, `stackTrace`) which can churn across navigations or
   * reloads without the tool itself actually changing.
   *
   * `Hash.hash` structural-hashes the value deterministically and
   * order-independently (XOR folding of key/value hashes), and treats
   * `undefined` consistently, so absent optional fields don't cause spurious
   * diffs.
   */
  get key(): string {
    return Hash.hash({
      name: this.name,
      description: this.description,
      inputSchema: this.inputSchema,
      outputSchema: this.outputSchema,
      annotations: this.annotations,
    }).toString();
  }
}

export class WebMcpToolContainer extends Schema.Class<WebMcpToolContainer>("WebMcpToolContainer")({
  metadata: WebMcpToolMetadata,
  tool: WebMcpTool,
}) { }

export const WebMcpToolContainers = Schema.Array(WebMcpToolContainer);
