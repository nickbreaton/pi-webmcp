import { Context, Effect, Layer, Stream } from "effect";
import { WebMcpTool } from "../schemas/WebMcpTool";
import { WebMcpEvent, WebMcpEventService, WebMcpEventToolRemoved } from "./WebMcpEventService";

function toolKey(sessionId: string, tool: WebMcpTool): string {
  return `${sessionId}::${tool.frameId}::${tool.name}`;
}

function toolKeyFromRemove(event: typeof WebMcpEventToolRemoved.Type): string {
  return `${event.sessionId}::${event.frameId}::${event.name}`;
}

type Registry = Map<string, WebMcpTool>;

function applyEvent(registry: Registry, event: WebMcpEvent): Registry {
  switch (event._tag) {
    case "WebMcpEventToolAdded": {
      const key = toolKey(event.sessionId, event.tool);
      const next = new Map(registry);
      next.set(key, event.tool);
      return next;
    }
    case "WebMcpEventToolRemoved": {
      const key = toolKeyFromRemove(event);
      const next = new Map(registry);
      next.delete(key);
      return next;
    }
    case "WebMcpEventSessionCleared": {
      const next = new Map(registry);
      for (const key of registry.keys()) {
        if (key.startsWith(`${event.sessionId}::`)) {
          next.delete(key);
        }
      }
      return next;
    }
  }
}

function toArray(registry: Registry): WebMcpTool[] {
  return [...registry.values()];
}

export class WebMcpToolsService extends Context.Service<WebMcpToolsService, {
  readonly changes: Stream.Stream<WebMcpTool[], never, never>;
}>()("webmcp/WebMcpToolsService") {
  static readonly liveWithoutDependencies = Layer.effect(
    WebMcpToolsService,
    Effect.gen(function* () {
      const events = yield* WebMcpEventService;

      return WebMcpToolsService.of({
        changes: events.changes.pipe(
          Stream.scan(new Map<string, WebMcpTool>(), applyEvent),
          Stream.map(toArray),
        ),
      });
    }),
  );

  static readonly live = WebMcpToolsService.liveWithoutDependencies.pipe(
    Layer.provide(WebMcpEventService.live),
  );
}
