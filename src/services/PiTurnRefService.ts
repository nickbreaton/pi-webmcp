import { Context, Effect, Layer, Option, Ref, Scope } from "effect";

export class PiTurnRefService extends Context.Service<PiTurnRefService, {
  readonly make: <A>(value?: Option.Option<A>) => Effect.Effect<Ref.Ref<Option.Option<A>>, never, Scope.Scope>;
  readonly reset: () => Effect.Effect<void>;
}>()("pi-webmcp/PiTurnRefService") {
  static readonly live = Layer.effect(
    PiTurnRefService,
    Effect.gen(function*() {
      const refs = new Set<Ref.Ref<Option.Option<any>>>();

      return PiTurnRefService.of({
        make: Effect.fn("PiTurnRefService.make")(function*<A>(value: Option.Option<A> = Option.none()) {
          const ref = yield* Ref.make(value);

          refs.add(ref);

          yield* Effect.addFinalizer(() => {
            return Effect.sync(() => refs.delete(ref));
          });

          return ref;
        }),
        reset: Effect.fn("PiTurnRefService.reset")(function*() {
          for (const ref of refs) {
            yield* Ref.set(ref, Option.none());
          }
        }),
      });
    }),
  );
}
