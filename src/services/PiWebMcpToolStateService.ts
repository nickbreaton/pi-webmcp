import { Context, Effect, Layer, Option, Ref, Result, Schema } from "effect";
import { WebMcpTool, WebMcpTools } from "../schemas/WebMcpTool";
import { PiContext } from "./PiApi";

export class PiWebMcpToolStateService extends Context.Service<PiWebMcpToolStateService, {
  readonly stage: (tools: WebMcpTool[]) => Effect.Effect<void>;
  readonly staged: Effect.Effect<WebMcpTool[]>;
  readonly commit: Effect.Effect<Option.Option<WebMcpTool[]>>;
  readonly committed: Effect.Effect<WebMcpTool[], never, PiContext>;
}>()("pi-webmcp/PiWebMcpToolStateService") {
  static readonly live = Layer.effect(
    PiWebMcpToolStateService,
    Effect.gen(function*() {
      const stagedRef = yield* Ref.make<Option.Option<WebMcpTool[]>>(Option.none());

      return PiWebMcpToolStateService.of({
        stage: (tools) => Ref.set(stagedRef, Option.some(tools)),
        staged: Ref.get(stagedRef).pipe(Effect.map(Option.getOrElse(() => []))),
        commit: Ref.getAndSet(stagedRef, Option.none()),
        committed: Effect.gen(function*() {
          const ctx = yield* PiContext;
          const branch = ctx.sessionManager.getBranch();

          for (let index = branch.length - 1; index >= 0; index--) {
            const entry = branch[index];
            if (entry.type !== "message") continue;
            if (entry.message?.role !== "user") continue;

            const details = entry.message as typeof entry.message & { details?: { webmcp?: { tools?: unknown; }; }; };
            const result = Schema.decodeUnknownResult(WebMcpTools)(details.details?.webmcp?.tools);

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
