import { Context, Effect, Layer, Option, Ref, Result, Schema } from "effect";
import { WebMcpTool, WebMcpTools } from "../schemas/WebMcpTool";
import { PiContext } from "./PiApi";

export class PiWebMcpToolStateService extends Context.Service<PiWebMcpToolStateService, {
  readonly stage: (tools: WebMcpTool[]) => Effect.Effect<void>;
  readonly staged: Effect.Effect<WebMcpTool[]>;
  readonly commit: () => Effect.Effect<Option.Option<WebMcpTool[]>>;
  readonly committed: Effect.Effect<WebMcpTool[], never, PiContext>;
}>()("pi-webmcp/PiWebMcpToolStateService") {
  static readonly live = Layer.effect(
    PiWebMcpToolStateService,
    Effect.gen(function*() {
      const stagedRef = yield* Ref.make<Option.Option<WebMcpTool[]>>(Option.none());

      return PiWebMcpToolStateService.of({
        stage: Effect.fn("PiWebMcpToolStateService.stage")(function*(tools: WebMcpTool[]) {
          yield* Ref.set(stagedRef, Option.some(tools));
        }),
        staged: Effect.gen(function*() {
          const tools = yield* Ref.get(stagedRef);
          return Option.getOrElse(tools, () => []);
        }),
        commit: Effect.fn("PiWebMcpToolStateService.commit")(function*() {
          return yield* Ref.getAndSet(stagedRef, Option.none());
        }),
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
