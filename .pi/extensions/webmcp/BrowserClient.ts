import CDP from "chrome-remote-interface";
import type { Client } from "chrome-remote-interface";
import { Context, Effect, Layer, Option, Ref, Schema, Scope } from "effect";

export type CdpClient = Client;

export class BrowserClientError extends Schema.TaggedErrorClass<BrowserClientError>()("BrowserClientError", {
  operation: Schema.Union([Schema.Literal("connect"), Schema.Literal("disconnect")]),
  cause: Schema.Unknown,
}) { }

export class BrowserClient extends Context.Service<BrowserClient, {
  readonly connect: () => Effect.Effect<CdpClient, BrowserClientError>;
  readonly get: Effect.Effect<Option.Option<CdpClient>>;
  readonly disconnect: () => Effect.Effect<void, BrowserClientError>;
}>()("webmcp/BrowserClient") {
  static readonly layer = (target: string) => Layer.effect(
    BrowserClient,
    Effect.gen(function* () {
      const clientRef = yield* Ref.make<Option.Option<CdpClient>>(Option.none());
      const scope = yield* Effect.scope;

      const clear = Ref.set(clientRef, Option.none());

      const connect = Effect.fn("BrowserClient.connect")(function* () {
        const existing = yield* Ref.get(clientRef);
        if (Option.isSome(existing)) return existing.value;

        const client = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => CDP({ target, local: true }),
            catch: (cause) => new BrowserClientError({ operation: "connect", cause }),
          }),
          (client) => Effect.gen(function* () {
            const existing = yield* Ref.get(clientRef);
            if (Option.isNone(existing) || existing.value !== client) return;
            yield* Ref.set(clientRef, Option.none());
            yield* Effect.tryPromise({
              try: () => client.close(),
              catch: (cause) => new BrowserClientError({ operation: "disconnect", cause }),
            }).pipe(Effect.ignore);
          }),
        ).pipe(Scope.provide(scope));

        const clearUnsafe = () => Effect.runFork(clear);
        client.on("disconnect", clearUnsafe);
        client.on("error", clearUnsafe);
        yield* Ref.set(clientRef, Option.some(client));
        return client;
      });

      const disconnect = Effect.fn("BrowserClient.disconnect")(function* () {
        const existing = yield* Ref.get(clientRef);
        if (Option.isNone(existing)) return;
        yield* Ref.set(clientRef, Option.none());
        yield* Effect.tryPromise({
          try: () => existing.value.close(),
          catch: (cause) => new BrowserClientError({ operation: "disconnect", cause }),
        });
      });

      return BrowserClient.of({
        connect,
        get: Ref.get(clientRef),
        disconnect,
      });
    }),
  );
}
