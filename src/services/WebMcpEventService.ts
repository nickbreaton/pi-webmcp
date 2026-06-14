import { Context, Effect, Layer, Queue, Schema, Stream } from "effect";
import { WebMcpToolContainer } from "../schemas/WebMcpTool";
import { BrowserClient } from "./BrowserClient";

export const WebMcpEventAdd = Schema.TaggedStruct("WebMcpEventAdd", {
  container: WebMcpToolContainer,
});

export const WebMcpEventRemove = Schema.TaggedStruct("WebMcpEventRemove", {
  targetId: Schema.String,
  frameId: Schema.String,
  name: Schema.String,
});

export const WebMcpEventTargetDestroyed = Schema.TaggedStruct("WebMcpEventTargetDestroyed", {
  targetId: Schema.String,
});

export const WebMcpEvent = Schema.Union([
  WebMcpEventAdd,
  WebMcpEventRemove,
  WebMcpEventTargetDestroyed,
]);

export type WebMcpEvent = typeof WebMcpEvent.Type;

type TargetInfo = { targetId: string; title: string; url: string; type: string };

function isPageTarget(target: TargetInfo) {
  return target.type === "page" && !target.url.startsWith("chrome://") && !target.url.startsWith("devtools://");
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

        return Stream.callback<WebMcpEvent>((queue) => {
          return Effect.gen(function* () {
            const sessions = new Map<string, string>(); // sessionId -> targetId
            const targets = new Map<string, TargetInfo>();  // targetId -> targetInfo

            const sessionForTarget = (targetId: string) => {
              for (const [sid, tid] of sessions) {
                if (tid === targetId) return sid;
              }
            };

            const attachTarget = async (targetInfo: TargetInfo) => {
              if (!isPageTarget(targetInfo)) return;
              if (sessionForTarget(targetInfo.targetId)) {
                targets.set(targetInfo.targetId, targetInfo);
                return;
              }
              try {
                const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: targetInfo.targetId, flatten: true });
                sessions.set(sessionId, targetInfo.targetId);
                targets.set(targetInfo.targetId, targetInfo);
                await cdp.send("WebMCP.enable", {}, sessionId);
              } catch {
                // Tab may have closed between discovery and attach
              }
            };

            const onToolsAdded = (ev: any, evSessionId?: string) => {
              if (!evSessionId) return;
              const targetId = sessions.get(evSessionId);
              if (!targetId) return;
              const target = targets.get(targetId);
              if (!target) return;

              for (const tool of ev.tools ?? []) {
                Queue.offerUnsafe(queue, WebMcpEventAdd.make({
                  container: {
                    metadata: {
                      targetId,
                      title: target.title,
                      url: target.url,
                    },
                    tool,
                  },
                }));
              }
            };

            const onToolsRemoved = (ev: any, evSessionId?: string) => {
              if (!evSessionId) return;
              const targetId = sessions.get(evSessionId);
              if (!targetId) return;

              for (const removed of ev.tools ?? []) {
                const name = removed?.name;
                const frameId = removed?.frameId;
                if (!name || !frameId) continue;
                Queue.offerUnsafe(queue, WebMcpEventRemove.make({ targetId, frameId, name }));
              }
            };

            const onTargetCreated = ({ targetInfo }: { targetInfo?: TargetInfo }) => {
              if (!targetInfo) return;
              void attachTarget(targetInfo);
            };

            const onTargetInfoChanged = ({ targetInfo }: { targetInfo?: TargetInfo }) => {
              if (!targetInfo || !isPageTarget(targetInfo)) return;
              const sessionId = sessionForTarget(targetInfo.targetId);
              if (!sessionId) {
                void attachTarget(targetInfo);
                return;
              }

              const previous = targets.get(targetInfo.targetId);
              if (previous && previous.url !== targetInfo.url) {
                // URL changed — all tools for this target are gone
                Queue.offerUnsafe(queue, WebMcpEventTargetDestroyed.make({ targetId: targetInfo.targetId }));
                // Re-enable WebMCP for the new page so toolsAdded events fire
                cdp.send("WebMCP.enable", {}, sessionId).catch(() => {});
              }
              targets.set(targetInfo.targetId, targetInfo);
            };

            const onTargetDestroyed = ({ targetId }: { targetId?: string }) => {
              if (!targetId) return;
              for (const [sid, tid] of sessions) {
                if (tid === targetId) {
                  sessions.delete(sid);
                  break;
                }
              }
              targets.delete(targetId);
              Queue.offerUnsafe(queue, WebMcpEventTargetDestroyed.make({ targetId }));
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
                    sessions.set(sessionId, target.targetId);
                    targets.set(target.targetId, target);
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

      return WebMcpEventService.of({
        changes: Stream.unwrap(setup.pipe(Effect.orDie)),
      });
    }),
  );

  static readonly live = WebMcpEventService.liveWithoutDependencies.pipe(
    Layer.provide(BrowserClient.live),
  );
}
