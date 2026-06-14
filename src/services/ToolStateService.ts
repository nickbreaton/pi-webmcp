import { Context, Effect, Layer, Ref, Result, Schema } from "effect";
import { WebMcpToolContainers, type WebMcpToolContainer } from "../schemas/WebMcpTool";
import { PiContext } from "./PiApi";

export class ToolStateService extends Context.Service<ToolStateService, {
  readonly stage: (tools: WebMcpToolContainer[]) => Effect.Effect<void>;
  readonly staged: Effect.Effect<WebMcpToolContainer[]>;
  readonly commit: Effect.Effect<WebMcpToolContainer[]>;
  readonly committed: Effect.Effect<WebMcpToolContainer[], never, PiContext>;
}>()("webmcp/ToolStateService") {
  static readonly live = Layer.effect(
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
