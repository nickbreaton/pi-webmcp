import { Context, Effect, Layer, Schema, Stream } from "effect";
import { WebMcpToolContainer } from "../schemas/WebMcpTool";
import { BrowserClient } from "./BrowserClient";

export const WebMcpDiscoverAdd = Schema.TaggedStruct("WebMcpDiscoverAdd", {
  container: WebMcpToolContainer,
});

export const WebMcpDiscoverRemove = Schema.TaggedStruct("WebMcpDiscoverRemove", {
  id: Schema.String,
});

export const WebMcpDiscoverEvent = Schema.Union([
  WebMcpDiscoverAdd,
  WebMcpDiscoverRemove,
]);

export type WebMcpDiscoverEvent = typeof WebMcpDiscoverEvent.Type;

type TargetInfo = { targetId: string; title: string; url: string; type: string };

function isPageTarget(target: TargetInfo) {
  return target.type === "page" && !target.url.startsWith("chrome://") && !target.url.startsWith("devtools://");
}

export class WebMcpDiscoverService extends Context.Service<WebMcpDiscoverService, {
  readonly changes: Stream.Stream<WebMcpDiscoverEvent, never, never>;
}>()("webmcp/WebMcpDiscoverService") {
  static readonly liveWithoutDependencies = Layer.effect(
    WebMcpDiscoverService,
    Effect.gen(function* () {
      const browser = yield* BrowserClient;

      const setup = Effect.gen(function* () {
        const cdp = yield* browser.connect();

        return Stream.callback<WebMcpDiscoverEvent>((queue) => {
          return Effect.gen(function* () {
            const onToolsAdded = (ev: any, _evSessionId?: string) => {
              console.log("WebMCP.toolsAdded", ev);
            };

            const onToolsRemoved = (ev: any, _evSessionId?: string) => {
              console.log("WebMCP.toolsRemoved", ev);
            };

            const onTargetCreated = async ({ targetInfo }: { targetInfo?: TargetInfo }) => {
              if (!targetInfo || !isPageTarget(targetInfo)) return;
              try {
                const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: targetInfo.targetId, flatten: true });
                await cdp.send("WebMCP.enable", {}, sessionId);
                console.log("Attached to new target", targetInfo.title);
              } catch {
                // Tab may have closed between discovery and attach
              }
            };

            const onTargetInfoChanged = ({ targetInfo }: { targetInfo?: TargetInfo }) => {
              if (!targetInfo || !isPageTarget(targetInfo)) return;
              console.log("Target.targetInfoChanged", targetInfo.title);
            };

            const onTargetDestroyed = ({ targetId }: { targetId?: string }) => {
              if (!targetId) return;
              console.log("Target.targetDestroyed", targetId);
            };

            yield* Effect.acquireRelease(
              Effect.gen(function* () {
                yield* Effect.sync(() => cdp.on("WebMCP.toolsAdded", onToolsAdded));
                yield* Effect.sync(() => cdp.on("WebMCP.toolsRemoved", onToolsRemoved));
                yield* Effect.sync(() => cdp.on("Target.targetCreated", onTargetCreated));
                yield* Effect.sync(() => cdp.on("Target.targetInfoChanged", onTargetInfoChanged));
                yield* Effect.sync(() => cdp.on("Target.targetDestroyed", onTargetDestroyed));

                yield* Effect.tryPromise(() => cdp.send("Target.setDiscoverTargets", { discover: true }));

                const { targetInfos } = yield* Effect.tryPromise(() => cdp.send("Target.getTargets"));
                const pages: TargetInfo[] = targetInfos?.filter(isPageTarget) ?? [];
                for (const target of pages) {
                  yield* Effect.gen(function* () {
                    const { sessionId } = yield* Effect.tryPromise(() => cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true }));
                    yield* Effect.tryPromise(() => cdp.send("WebMCP.enable", {}, sessionId));
                  }).pipe(Effect.ignore);
                }
              }).pipe(Effect.ignore),
              () => Effect.sync(() => {
                cdp.off!("WebMCP.toolsAdded", onToolsAdded);
                cdp.off!("WebMCP.toolsRemoved", onToolsRemoved);
                cdp.off!("Target.targetCreated", onTargetCreated);
                cdp.off!("Target.targetInfoChanged", onTargetInfoChanged);
                cdp.off!("Target.targetDestroyed", onTargetDestroyed);
              })
            );
          }).pipe(Effect.ignore);
        });
      });

      return WebMcpDiscoverService.of({
        changes: Stream.unwrap(setup.pipe(Effect.orDie)),
      });
    }),
  );

  static readonly live = WebMcpDiscoverService.liveWithoutDependencies.pipe(
    Layer.provide(BrowserClient.live),
  );
}
