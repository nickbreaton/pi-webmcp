import { Theme } from "@earendil-works/pi-coding-agent";
import { type Component, TUI } from "@earendil-works/pi-tui";
import { Context, Effect, Layer, Ref } from "effect";
import { PiContext } from "./PiApi";

/**
 * The `webmcp-list` widget content accepted by `ctx.ui.setWidget`.
 */
export type PiWebMcpListWidget = Component & { dispose?(): void; };

/**
 * Factory that produces the list widget, matching the shape accepted by
 * `ctx.ui.setWidget`'s component overload.
 */
export type PiWebMcpListWidgetFactory = (tui: TUI, theme: Theme) => PiWebMcpListWidget;

/**
 * Owns the `webmcp-list` widget and tracks whether it is currently visible.
 *
 * Visibility lives in a Ref so every read goes through Effect. Call sites
 * outside the runtime (e.g. the raw terminal-input handler) reach it the same
 * way as any other service, via `runtime.runPromise`.
 */
export class PiWebMcpListWidgetService extends Context.Service<PiWebMcpListWidgetService, {
  /** Show the list widget using the given factory and mark it visible. */
  readonly show: (factory: PiWebMcpListWidgetFactory) => Effect.Effect<void, never, PiContext>;
  /** Hide the list widget and mark it not visible. */
  readonly hide: () => Effect.Effect<void, never, PiContext>;
  /** Whether the list widget is currently visible. */
  readonly isVisible: Effect.Effect<boolean>;
}>()("pi-webmcp/PiWebMcpListWidgetService") {
  static readonly live = Layer.effect(
    PiWebMcpListWidgetService,
    Effect.gen(function*() {
      const ctx = yield* PiContext;
      const visibleRef = yield* Ref.make<boolean>(false);

      return PiWebMcpListWidgetService.of({
        show: Effect.fn("PiWebMcpListWidgetService.show")(function*(factory: PiWebMcpListWidgetFactory) {
          ctx.ui.setWidget("webmcp-list", factory);
          yield* Ref.set(visibleRef, true);
        }),
        hide: Effect.fn("PiWebMcpListWidgetService.hide")(function*() {
          ctx.ui.setWidget("webmcp-list", undefined);
          yield* Ref.set(visibleRef, false);
        }),
        isVisible: Ref.get(visibleRef),
      });
    }),
  );
}
