import { Context, Effect, Layer, Option, Result, Schema, SchemaTransformation } from "effect";
import { BrowserClient } from "./BrowserClient";
import { PiContext } from "./PiApi";

const Subcommand = Schema.Literals([
  "connect",
  "disconnect",
]);

export type SubcommandCompletion = {
  value: typeof Subcommand.Type;
  label: typeof Subcommand.Type;
  detail: string;
};

export class WebMcpCommandService extends Context.Service<WebMcpCommandService, {
  readonly handle: (args: string) => Effect.Effect<void, never, PiContext>;
}>()("webmcp/WebMcpCommandService") {
  static readonly completions: SubcommandCompletion[] = [
    {
      value: "connect",
      label: "connect",
      detail: "Scan Chrome WebMCP tools",
    },
    {
      value: "disconnect",
      label: "disconnect",
      detail: "Disconnect from Chrome WebMCP",
    },
  ];

  static readonly layer = Layer.effect(
    WebMcpCommandService,
    Effect.gen(function* () {
      const browser = yield* BrowserClient;
      const ctx = yield* PiContext;

      return WebMcpCommandService.of({
        handle: (args) => Effect.gen(function* () {
          const result = Schema.String.pipe(
            Schema.decode(SchemaTransformation.trim().compose(SchemaTransformation.toLowerCase())),
            Schema.decodeTo(Schema.Literals(["", ...Subcommand.literals])),
            schema => Schema.decodeUnknownResult(schema)(args),
          );

          if (Result.isFailure(result)) {
            ctx.ui.notify(`Usage: /webmcp [${Subcommand.literals.join("|")}]`, "error");
            return;
          }

          const command = result.success;

          if (command === "disconnect") {
            const cdp = Option.getOrUndefined(yield* browser.get);
            void cdp;
            // TODO: detach active CDP target sessions before disconnecting.
            yield* browser.disconnect().pipe(Effect.ignore);
            // TODO: reset the command/tool monitor state (`monitoring = false`).
            // TODO: clear the WebMCP tool registry.
            ctx.ui.notify("WebMCP disconnected from Chrome.", "info");
            return;
          }

          // TODO: remember the current Pi context as `lastCtx` for discovery notifications.
          // TODO: if no browser connection exists yet, reset `monitoring = false` before connecting.
          yield* browser.connect().pipe(
            // TODO: register `disconnect` and `error` handlers that clear browser/session state.
            // TODO: run a full WebMCP scan and store discovered tools (`scanAndStore("", true)`).
            // TODO: notify the user/LLM about discovery diffs after scanning.
            // TODO: preserve the fallback info notification when the scan finds no new tools.
            Effect.catch(err => Effect.sync(() => {
              ctx.ui.notify(`WebMCP scan failed: ${err.message ?? err} `, "error");
            })),
          );
        }),
      });
    }),
  );
}
