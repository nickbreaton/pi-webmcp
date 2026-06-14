import { Context, Effect, Layer, Ref, Result, Schema } from "effect";
import { PiContext } from "./PiApi";

const WebMcpToolAnnotation = Schema.Struct({
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

export type WebMcpToolMetadata = typeof WebMcpToolMetadata.Type;
export type WebMcpTool = typeof WebMcpTool.Type;
export type WebMcpToolContainer = typeof WebMcpToolContainer.Type;

const WebMcpToolContainers = Schema.Array(WebMcpToolContainer);

export class ToolStateService extends Context.Service<ToolStateService, {
  readonly stage: (tools: WebMcpToolContainer[]) => Effect.Effect<void>;
  readonly staged: Effect.Effect<WebMcpToolContainer[]>;
  readonly commit: Effect.Effect<WebMcpToolContainer[]>;
  readonly committed: Effect.Effect<WebMcpToolContainer[], never, PiContext>;
}>()("webmcp/ToolStateService") {
  static readonly layer = Layer.effect(
    ToolStateService,
    Effect.gen(function* () {
      const stagedRef = yield* Ref.make<WebMcpToolContainer[]>([]);

      return ToolStateService.of({
        stage: (tools) => Ref.set(stagedRef, tools),
        staged: Ref.get(stagedRef),
        commit: Effect.gen(function* () {
          const tools = yield* Ref.get(stagedRef);
          yield* Ref.set(stagedRef, []);
          return tools;
        }),
        committed: Effect.gen(function* () {
          const ctx = yield* PiContext;
          const branch = ctx.sessionManager.getBranch();

          for (let index = branch.length - 1; index >= 0; index--) {
            const entry = branch[index];
            if (entry.type !== "message") continue;
            if (entry.message?.role !== "toolResult") continue;
            if (entry.message.toolName !== "webmcp_list") continue;

            const result = Schema.decodeUnknownResult(WebMcpToolContainers)(entry.message.details?.tools);

            if (Result.isSuccess(result)) {
              return result.success.map(tool => ({ ...tool }));
            }
          }

          return [];
        }),
      });
    }),
  );
}
