import CDP from "chrome-remote-interface";
import type { Client } from "chrome-remote-interface";
import { Context, Effect, Layer, Option, Ref, Schema, Scope } from "effect";

// The Chrome type package only includes the standard protocol schema, but WebMCP
// exposes experimental `WebMCP.*` commands/events through the same CDP client.
// Keep this local widening until we add proper generated protocol typings for
// the WebMCP domain.
export type CdpClient = Client & {
  send(method: string, params?: any, sessionId?: string): Promise<any>;
  on(method: string, cb: (params: any, sessionId?: string) => void): void;
};

const DEFAULT_HOST = process.env.CDP_HOST ?? "127.0.0.1";
const DEFAULT_PORT = Number(process.env.CDP_PORT ?? 9222);
const DEFAULT_WS = process.env.CDP_WS ?? `ws://${DEFAULT_HOST}:${DEFAULT_PORT}/devtools/browser`;

export class BrowserClientError extends Schema.TaggedErrorClass<BrowserClientError>()("BrowserClientError", {
  operation: Schema.Union([Schema.Literal("connect"), Schema.Literal("disconnect")]),
  cause: Schema.Unknown,
}) { }

export class BrowserClient extends Context.Service<BrowserClient, {
  readonly connect: () => Effect.Effect<CdpClient, BrowserClientError>;
  readonly get: Effect.Effect<Option.Option<CdpClient>>;
  readonly disconnect: () => Effect.Effect<void, BrowserClientError>;
}>()("webmcp/BrowserClient") {
  static readonly layer = Layer.effect(
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
            try: () => CDP({ target: DEFAULT_WS, local: true }),
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

        const clearUnsafe = () => Effect.runSync(clear);
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
