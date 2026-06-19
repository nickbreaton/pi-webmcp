import { Context, Effect, Layer, Queue, Result, Schema, Stream } from "effect";
import { WebMcpTool } from "../schemas/WebMcpTool";
import { BrowserClient } from "./BrowserClient";

export const WebMcpEventToolAdded = Schema.TaggedStruct("WebMcpEventToolAdded", {
  sessionId: Schema.String,
  tool: WebMcpTool,
});

export const WebMcpEventToolRemoved = Schema.TaggedStruct("WebMcpEventToolRemoved", {
  sessionId: Schema.String,
  frameId: Schema.String,
  name: Schema.String,
});

export const WebMcpEventSessionCleared = Schema.TaggedStruct("WebMcpEventSessionCleared", {
  sessionId: Schema.String,
});

export const WebMcpEvent = Schema.Union([
  WebMcpEventToolAdded,
  WebMcpEventToolRemoved,
  WebMcpEventSessionCleared,
]);

export type WebMcpEvent = typeof WebMcpEvent.Type;

class TargetInfo extends Schema.Class<TargetInfo>("TargetInfo")({
  targetId: Schema.String,
  title: Schema.String,
  url: Schema.URLFromString,
  type: Schema.String,
  attached: Schema.optionalKey(Schema.Boolean),
}) { }

function isPageTarget(target: TargetInfo) {
  return target.type === "page" && target.url.protocol !== "chrome:" && target.url.protocol !== "devtools:";
}

export class WebMcpEventService extends Context.Service<WebMcpEventService, {
  readonly changes: Stream.Stream<WebMcpEvent, never, never>;
}>()("webmcp/WebMcpEventService") {
  static readonly liveWithoutDependencies = Layer.effect(
    WebMcpEventService,
    Effect.gen(function* () {
      const browser = yield* BrowserClient;

      const setup = Effect.gen(function* () {
        const cdp = yield* browser.connect();
        const targetBySession = new Map<string, TargetInfo>();

        return Stream.callback<WebMcpEvent>((queue) => {
          return Effect.gen(function* () {
            const attachTarget = async (target: TargetInfo) => {
              if (!isPageTarget(target) || target.attached) return;
              try {
                const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
                targetBySession.set(sessionId, target);
                await cdp.send("Page.enable", {}, sessionId);
                await cdp.send("WebMCP.enable", {}, sessionId);
              } catch {
                // Tab may have closed between discovery and attach
              }
            };

            const onToolsAdded = (ev: any, sessionId?: string) => {
              if (!sessionId) return;
              const target = targetBySession.get(sessionId);
              if (!target) throw new Error(`Missing target info for WebMCP session: ${sessionId}`);
              const origin = target.url.host;
              for (const tool of ev.tools ?? []) {
                const result = Schema.decodeUnknownResult(WebMcpTool)({ ...tool, origin, sessionId });
                if (Result.isFailure(result)) continue;
                Queue.offerUnsafe(queue, WebMcpEventToolAdded.make({ sessionId, tool: result.success }));
              }
            };

            const onToolsRemoved = (ev: any, sessionId?: string) => {
              if (!sessionId) return;
              for (const removed of ev.tools ?? []) {
                const name = removed?.name;
                const frameId = removed?.frameId;
                if (!name || !frameId) continue;
                Queue.offerUnsafe(queue, WebMcpEventToolRemoved.make({ sessionId, frameId, name }));
              }
            };

            const onFrameNavigated = (ev: any, sessionId?: string) => {
              if (!sessionId || ev.frame?.parentId) return;
              Queue.offerUnsafe(queue, WebMcpEventSessionCleared.make({ sessionId }));
              cdp.send("WebMCP.enable", {}, sessionId).catch(() => { });
            };

            const onDetachedFromTarget = ({ sessionId }: { sessionId?: string }) => {
              if (!sessionId) return;
              targetBySession.delete(sessionId);
              Queue.offerUnsafe(queue, WebMcpEventSessionCleared.make({ sessionId }));
            };

            const onTargetCreated = ({ targetInfo }: { targetInfo?: unknown }) => {
              if (!targetInfo) return;
              void attachTarget(Schema.decodeUnknownSync(TargetInfo)(targetInfo));
            };

            const onTargetInfoChanged = ({ targetInfo }: { targetInfo?: unknown }) => {
              if (!targetInfo) return;
              void attachTarget(Schema.decodeUnknownSync(TargetInfo)(targetInfo));
            };

            yield* Effect.acquireRelease(
              Effect.gen(function* () {
                yield* Effect.sync(() => cdp.on("WebMCP.toolsAdded", onToolsAdded));
                yield* Effect.sync(() => cdp.on("WebMCP.toolsRemoved", onToolsRemoved));
                yield* Effect.sync(() => cdp.on("Page.frameNavigated", onFrameNavigated));
                yield* Effect.sync(() => cdp.on("Target.detachedFromTarget", onDetachedFromTarget));
                yield* Effect.sync(() => cdp.on("Target.targetCreated", onTargetCreated));
                yield* Effect.sync(() => cdp.on("Target.targetInfoChanged", onTargetInfoChanged));

                yield* Effect.tryPromise(() => cdp.send("Target.setDiscoverTargets", { discover: true }));

                const { targetInfos } = yield* Effect.tryPromise(() => cdp.send("Target.getTargets"));
                const pages = targetInfos?.map((targetInfo: unknown) => Schema.decodeUnknownSync(TargetInfo)(targetInfo)).filter(isPageTarget) ?? [];
                for (const target of pages) {
                  yield* Effect.tryPromise(() => attachTarget(target)).pipe(Effect.ignore);
                }
              }).pipe(Effect.ignore),
              () => Effect.sync(() => {
                cdp.off!("WebMCP.toolsAdded", onToolsAdded);
                cdp.off!("WebMCP.toolsRemoved", onToolsRemoved);
                cdp.off!("Page.frameNavigated", onFrameNavigated);
                cdp.off!("Target.detachedFromTarget", onDetachedFromTarget);
                cdp.off!("Target.targetCreated", onTargetCreated);
                cdp.off!("Target.targetInfoChanged", onTargetInfoChanged);
              })
            );
          }).pipe(Effect.ignore);
        });
      });

      return WebMcpEventService.of({
        changes: Stream.unwrap(setup.pipe(Effect.orDie)),
      });
    }),
  );

  static readonly live = WebMcpEventService.liveWithoutDependencies.pipe(
    Layer.provide(BrowserClient.live),
  );
}
