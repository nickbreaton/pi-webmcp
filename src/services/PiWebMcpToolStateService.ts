import { Context, Effect, Layer, Ref, Result, Schema } from "effect";
import { WebMcpTool } from "../schemas/WebMcpTool";
import { PiContext } from "./PiApi";

const WebMcpTools = Schema.Array(WebMcpTool);

function decodeTools(value: unknown) {
  return Schema.decodeUnknownResult(WebMcpTools)(value);
}

export class PiWebMcpToolStateService extends Context.Service<PiWebMcpToolStateService, {
  readonly stage: (tools: WebMcpTool[]) => Effect.Effect<void>;
  readonly staged: Effect.Effect<WebMcpTool[]>;
  readonly commit: Effect.Effect<WebMcpTool[]>;
  readonly committed: Effect.Effect<WebMcpTool[], never, PiContext>;
}>()("webmcp/PiWebMcpToolStateService") {
  static readonly live = Layer.effect(
    PiWebMcpToolStateService,
    Effect.gen(function* () {
      const stagedRef = yield* Ref.make<WebMcpTool[]>([]);

      return PiWebMcpToolStateService.of({
        stage: (tools) => Ref.set(stagedRef, tools),
        staged: Ref.get(stagedRef),
        commit: Ref.getAndSet(stagedRef, []),
        committed: Effect.gen(function* () {
          const ctx = yield* PiContext;
          const branch = ctx.sessionManager.getBranch();

          for (let index = branch.length - 1; index >= 0; index--) {
            const entry = branch[index];
            if (entry.type !== "message") continue;
            if (entry.message?.role !== "user") continue;

            const details = entry.message as typeof entry.message & { details?: { webmcp?: { tools?: unknown } } };
            const result = decodeTools(details.details?.webmcp?.tools);

            if (Result.isSuccess(result)) {
              return [...result.success];
            }
          }

          return [];
        }),
      });
    }),
  );
}
