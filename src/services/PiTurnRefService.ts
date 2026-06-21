import { Context, Effect, Layer, Option, Ref, Scope } from "effect";

export class PiTurnRefService extends Context.Service<PiTurnRefService, {
  readonly make: <A>(value?: Option.Option<A>) => Effect.Effect<Ref.Ref<Option.Option<A>>, never, Scope.Scope>;
  readonly reset: () => Effect.Effect<void>;
}>()("pi/PiTurnRefService") {
  static readonly live = Layer.effect(
    PiTurnRefService,
    Effect.gen(function*() {
      const refs = new Set<Ref.Ref<Option.Option<any>>>();

      return PiTurnRefService.of({
        make: (value = Option.none()) =>
          Effect.gen(function*() {
            const ref = yield* Ref.make(value);

            refs.add(ref);

            yield* Effect.addFinalizer(() => {
              return Effect.sync(() => refs.delete(ref));
            });

            return ref;
          }),
        reset: Effect.fn(function*() {
          for (const ref of refs) {
            yield* Ref.set(ref, Option.none());
          }
        }),
      });
    }),
  );
}
