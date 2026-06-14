import { Context, Effect, Layer, Match, Stream } from "effect";
import { WebMcpTool } from "../schemas/WebMcpTool";
import { WebMcpEventService } from "./WebMcpEventService";

export class WebMcpToolsService extends Context.Service<WebMcpToolsService, {
  readonly changes: Stream.Stream<WebMcpTool[], never, never>;
}>()("webmcp/WebMcpToolsService") {
  static readonly liveWithoutDependencies = Layer.effect(
    WebMcpToolsService,
    Effect.gen(function* () {
      const events = yield* WebMcpEventService;

      return WebMcpToolsService.of({
        changes: events.changes.pipe(
          Stream.scan(new Map<string, WebMcpTool>(), (registry: Map<string, WebMcpTool>, event) =>
            Match.valueTags(event, {
              WebMcpEventToolAdded: ({ sessionId, tool }) => {
                const next = new Map(registry);
                next.set(`${sessionId}::${tool.frameId}::${tool.name}`, tool);
                return next;
              },
              WebMcpEventToolRemoved: ({ sessionId, frameId, name }) => {
                const next = new Map(registry);
                next.delete(`${sessionId}::${frameId}::${name}`);
                return next;
              },
              WebMcpEventSessionCleared: ({ sessionId }) => {
                const next = new Map(registry);
                for (const key of registry.keys()) {
                  if (key.startsWith(`${sessionId}::`)) {
                    next.delete(key);
                  }
                }
                return next;
              },
            })
          ),
          Stream.map((registry) => [...registry.values()]),
        ),
      });
    }),
  );

  static readonly live = WebMcpToolsService.liveWithoutDependencies.pipe(
    Layer.provide(WebMcpEventService.live),
  );
}
