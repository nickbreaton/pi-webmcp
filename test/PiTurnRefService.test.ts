import { describe, expect, it } from "@effect/vitest";
import { Effect, Option, Ref } from "effect";
import { PiTurnRefService } from "../src/services/PiTurnRefService";

describe("PiTurnRefService", () => {
  it.effect("make creates a ref initialized to none by default", () =>
    Effect.gen(function*() {
      const service = yield* PiTurnRefService;
      const ref = yield* Effect.scoped(service.make());
      expect(yield* Ref.get(ref)).toEqual(Option.none());
    }).pipe(Effect.provide(PiTurnRefService.live)));

  it.effect("make creates a ref initialized to the provided value", () =>
    Effect.gen(function*() {
      const service = yield* PiTurnRefService;
      const ref = yield* Effect.scoped(service.make(Option.some(42)));
      expect(yield* Ref.get(ref)).toEqual(Option.some(42));
    }).pipe(Effect.provide(PiTurnRefService.live)));

  it.effect("reset sets all tracked refs to none", () =>
    Effect.gen(function*() {
      const service = yield* PiTurnRefService;
      yield* Effect.scoped(
        Effect.gen(function*() {
          const ref1 = yield* service.make(Option.some(1));
          const ref2 = yield* service.make(Option.some(2));
          yield* service.reset();
          expect(yield* Ref.get(ref1)).toEqual(Option.none());
          expect(yield* Ref.get(ref2)).toEqual(Option.none());
        }),
      );
    }).pipe(Effect.provide(PiTurnRefService.live)));
});
