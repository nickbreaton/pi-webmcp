import CDP from "chrome-remote-interface";
import type { Client } from "chrome-remote-interface";
import { Context, Effect, Layer, Option, Ref, Schema, Scope } from "effect";
import { PiWebMcpSettingsService } from "./PiWebMcpSettingsService";

// The Chrome type package only includes the standard protocol schema, but WebMCP
// exposes experimental `WebMCP.*` commands/events through the same CDP client.
// Keep this local widening until we add proper generated protocol typings for
// the WebMCP domain.
export type CdpClient = Client & {
  send(method: string, params?: any, sessionId?: string): Promise<any>;
  on(method: string, cb: (params: any, sessionId?: string) => void): void;
  off?(method: string, cb: (params: any, sessionId?: string) => void): void;
};

export class BrowserClientError extends Schema.TaggedErrorClass<BrowserClientError>()("BrowserClientError", {
  operation: Schema.Union([Schema.Literal("connect"), Schema.Literal("disconnect")]),
  cause: Schema.Unknown,
}) {}

export class BrowserClient extends Context.Service<BrowserClient, {
  readonly connect: (options?: { readonly force?: boolean; }) => Effect.Effect<CdpClient, BrowserClientError>;
  readonly get: Effect.Effect<Option.Option<CdpClient>>;
  readonly disconnect: () => Effect.Effect<void, BrowserClientError>;
}>()("pi-webmcp/BrowserClient") {
  static readonly liveWithoutDependencies = Layer.effect(
    BrowserClient,
    Effect.gen(function*() {
      const clientRef = yield* Ref.make<Option.Option<CdpClient>>(Option.none());
      const scope = yield* Effect.scope;
      const context = yield* Effect.context();
      const settings = yield* PiWebMcpSettingsService;

      const clear = Ref.set(clientRef, Option.none());

      const connect = Effect.fn("BrowserClient.connect")(function*(options?: { readonly force?: boolean; }) {
        const existing = yield* Ref.get(clientRef);

        if (Option.isSome(existing)) {
          if (!options?.force) return existing.value;

          yield* Ref.set(clientRef, Option.none());
          yield* Effect.tryPromise({
            try: () => existing.value.close(),
            catch: (cause) => new BrowserClientError({ operation: "disconnect", cause }),
          }).pipe(Effect.ignore);
        }

        const client = yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () => CDP({ target: settings.cdpUrl.href, local: true }),
            catch: (cause) => new BrowserClientError({ operation: "connect", cause }),
          }),
          (client) =>
            Effect.gen(function*() {
              const existing = yield* Ref.get(clientRef);
              if (Option.isNone(existing) || existing.value !== client) return;
              yield* Ref.set(clientRef, Option.none());
              yield* Effect.tryPromise({
                try: () => client.close(),
                catch: (cause) => new BrowserClientError({ operation: "disconnect", cause }),
              }).pipe(Effect.ignore);
            }),
        ).pipe(Scope.provide(scope));

        client.on("disconnect", () => Effect.runSyncWith(context)(clear));
        yield* Ref.set(clientRef, Option.some(client));
        return client;
      });

      const disconnect = Effect.fn("BrowserClient.disconnect")(function*() {
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

  static readonly live = BrowserClient.liveWithoutDependencies.pipe(
    Layer.provide(PiWebMcpSettingsService.live),
  );
}
