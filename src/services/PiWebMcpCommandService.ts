import { Context, Effect, Layer, Result, Schema, SchemaTransformation, Stream } from "effect";
import { BrowserClient } from "./BrowserClient";
import { PiContext } from "./PiApi";
import { ToolScanService } from "./ToolScanService";
import { WebMcpToolsService } from "./WebMcpToolsService";

const Subcommand = Schema.Literals([
  "connect",
  "disconnect",
]);

const CommandArgs = Schema.String.pipe(
  Schema.decode(SchemaTransformation.trim().compose(SchemaTransformation.toLowerCase())),
  Schema.decodeTo(Schema.Literals(["", ...Subcommand.literals])),
);

export class PiWebMcpCommandService extends Context.Service<PiWebMcpCommandService, {
  readonly handle: (args: string) => Effect.Effect<void, never, PiContext>;
}>()("webmcp/PiWebMcpCommandService") {
  static readonly liveWithoutDependencies = Layer.effect(
    PiWebMcpCommandService,
    Effect.gen(function* () {
      const browser = yield* BrowserClient;
      const toolScan = yield* ToolScanService;
      const tools = yield* WebMcpToolsService;

      return PiWebMcpCommandService.of({
        handle: (args) => Effect.gen(function* () {
          const ctx = yield* PiContext;

          const result = Schema.decodeUnknownResult(CommandArgs)(args);

          if (Result.isFailure(result)) {
            ctx.ui.notify(`Usage: /webmcp [${Subcommand.literals.join("|")}]`, "error");
            return;
          }

          const command = result.success;

          if (command === "disconnect") {
            // TODO: detach active CDP target sessions before disconnecting.
            yield* browser.disconnect().pipe(Effect.ignore);
            // TODO: reset the command/tool monitor state (`monitoring = false`).
            // TODO: clear the WebMCP tool registry.
            ctx.ui.notify("WebMCP disconnected from Chrome.", "info");
            return;
          }

          // TODO: remember the current Pi context as `lastCtx` for discovery notifications.
          // TODO: if no browser connection exists yet, reset `monitoring = false` before connecting.
          // TODO: register `disconnect` and `error` handlers that clear browser/session state.
          // TODO: store discovered tools (`scanAndStore("", true)` equivalent).
          // TODO: notify the user/LLM about discovery diffs after scanning.
          // TODO: preserve the fallback info notification when the scan finds no new tools.
          yield* toolScan.scan.pipe(
            Effect.tap(tools => Effect.sync(() => {
              const names = tools.map(({ tool }) => tool.name).join(", ") || "none";
              ctx.ui.notify(`WebMCP scan result: ${names}`, "info");
            })),
            Effect.catch(err => Effect.sync(() => {
              ctx.ui.notify(`WebMCP scan failed: ${err instanceof Error ? err.message : err} `, "error");
            })),
          );

          yield* tools.changes.pipe(
            Stream.tap(tools => Effect.sync(() => {
              const names = tools.map(tool => tool.name).join(", ") || "none";
              ctx.ui.notify(`WebMCP tools: ${names}`, "info");
            })),
            Stream.runDrain,
            Effect.forkDetach,
          );
        }),
      });
    }),
  );

  static readonly live = PiWebMcpCommandService.liveWithoutDependencies.pipe(
    Layer.provide(ToolScanService.liveWithoutDependencies),
    Layer.provide(WebMcpToolsService.live),
  );
}
