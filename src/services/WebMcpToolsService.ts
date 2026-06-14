import { Context, Effect, Layer, Stream } from "effect";
import { WebMcpToolContainer } from "../schemas/WebMcpTool";
import { WebMcpEventService, WebMcpEvent, WebMcpEventRemove } from "./WebMcpEventService";

function toolKey(container: WebMcpToolContainer): string {
  return `${container.metadata.targetId}::${container.tool.frameId}::${container.tool.name}`;
}

function toolKeyFromRemove(event: typeof WebMcpEventRemove.Type): string {
  return `${event.targetId}::${event.frameId}::${event.name}`;
}

type Registry = Map<string, WebMcpToolContainer>;

function applyEvent(registry: Registry, event: WebMcpEvent): Registry {
  switch (event._tag) {
    case "WebMcpEventAdd": {
      const key = toolKey(event.container);
      const next = new Map(registry);
      next.set(key, event.container);
      return next;
    }
    case "WebMcpEventRemove": {
      const key = toolKeyFromRemove(event);
      const next = new Map(registry);
      next.delete(key);
      return next;
    }
    case "WebMcpEventTargetDestroyed": {
      const next = new Map(registry);
      for (const [key, container] of registry) {
        if (container.metadata.targetId === event.targetId) {
          next.delete(key);
        }
      }
      return next;
    }
  }
}

function toArray(registry: Registry): WebMcpToolContainer[] {
  return [...registry.values()];
}

export class WebMcpToolsService extends Context.Service<WebMcpToolsService, {
  readonly changes: Stream.Stream<WebMcpToolContainer[], never, never>;
}>()("webmcp/WebMcpToolsService") {
  static readonly liveWithoutDependencies = Layer.effect(
    WebMcpToolsService,
    Effect.gen(function* () {
      const events = yield* WebMcpEventService;

      return WebMcpToolsService.of({
        changes: events.changes.pipe(
          Stream.scan(new Map<string, WebMcpToolContainer>(), applyEvent),
          Stream.map(toArray),
        ),
      });
    }),
  );

  static readonly live = WebMcpToolsService.liveWithoutDependencies.pipe(
    Layer.provide(WebMcpEventService.live),
  );
}
