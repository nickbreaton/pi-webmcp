import { type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer, Ref } from "effect";
import { PiContext } from "./PiApi";

export type SetWidgetContent = Parameters<ExtensionUIContext["setWidget"]>[1];

export class PiWebMcpListWidgetService extends Context.Service<PiWebMcpListWidgetService, {
  readonly set: (factory: SetWidgetContent) => Effect.Effect<void, never>;
  readonly clear: () => Effect.Effect<void>;
  readonly isVisible: Effect.Effect<boolean>;
}>()("pi-webmcp/PiWebMcpListWidgetService") {
  static readonly live = Layer.effect(
    PiWebMcpListWidgetService,
    Effect.gen(function*() {
      const ctx = yield* PiContext;
      const visibleRef = yield* Ref.make<boolean>(false);
      const widgetId = "webmcp-list";

      return PiWebMcpListWidgetService.of({
        set: Effect.fn("PiWebMcpListWidgetService.set")(function*(setter: SetWidgetContent) {
          ctx.ui.setWidget(widgetId, setter);
          yield* Ref.set(visibleRef, true);
        }),
        clear: Effect.fn("PiWebMcpListWidgetService.clear")(function*() {
          ctx.ui.setWidget(widgetId, undefined);
          yield* Ref.set(visibleRef, false);
        }),
        isVisible: Ref.get(visibleRef),
      });
    }),
  );
}
