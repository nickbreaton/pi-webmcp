import { Context, Effect, Layer, Result, Schema, SchemaTransformation, Stream, SubscriptionRef } from "effect";
import { WebMcpTool } from "../schemas/WebMcpTool";
import { BrowserClient } from "./BrowserClient";
import { PiContext } from "./PiApi";
import { PiWebMcpToolStateService } from "./PiWebMcpToolStateService";
import { WebMcpToolDiff, WebMcpToolDiffService } from "./WebMcpToolDiffService";
import { WebMcpToolsService } from "./WebMcpToolsService";

const Subcommand = Schema.Literals([
  "connect",
  "disconnect",
]);

const CommandArgs = Schema.String.pipe(
  Schema.decode(SchemaTransformation.trim().compose(SchemaTransformation.toLowerCase())),
  Schema.decodeTo(Schema.Literals(["", ...Subcommand.literals])),
);

function toolName(tool: WebMcpTool) {
  return tool.name;
}

function formatList(items: string[]) {
  return items.length > 0 ? items.join(", ") : "none";
}

function formatDiff(diff: WebMcpToolDiff) {
  const parts: string[] = [];

  if (diff.added.length > 0) {
    parts.push(`new: ${formatList(diff.added.map(toolName))}`);
  }

  if (diff.removed.length > 0) {
    parts.push(`removed: ${formatList(diff.removed.map(toolName))}`);
  }

  return parts.join("; ");
}

export class PiWebMcpCommandService extends Context.Service<PiWebMcpCommandService, {
  readonly handle: (args: string) => Effect.Effect<void, never, PiContext>;
  readonly nudge: () => Effect.Effect<void>;
}>()("webmcp/PiWebMcpCommandService") {
  static readonly liveWithoutDependencies = Layer.effect(
    PiWebMcpCommandService,
    Effect.gen(function* () {
      const browser = yield* BrowserClient;
      const toolState = yield* PiWebMcpToolStateService;
      const tools = yield* WebMcpToolsService;
      const toolDiff = yield* WebMcpToolDiffService;
      const nudges = yield* SubscriptionRef.make<unknown>(null);

      const disconnect = Effect.fn("PiWebMcpCommandService.disconnect")(function* () {
        // TODO: detach active CDP target sessions before disconnecting.
        yield* browser.disconnect().pipe(Effect.ignore);
        yield* toolState.stage([]);
      });

      const connect = Effect.fn("PiWebMcpCommandService.connect")(function* () {
        const ctx = yield* PiContext;

        yield* tools.changes.pipe(
          Stream.zipLatestWith(SubscriptionRef.changes(nudges), (tools) => tools),
          // Stage every change immediately so the registry stays current.
          Stream.tap(active => toolState.stage(active)),
          // Only notify for the latest change once the agent is idle. If a
          // newer change arrives while we're waiting, `switchMap` interrupts
          // the pending notification and restarts with the latest state,
          // preventing a backlog of queued notifications.
          Stream.switchMap(active => Stream.fromEffectDrain(Effect.gen(function* () {
            yield* Effect.promise(() => ctx.waitForIdle());

            const committed = yield* toolState.committed;
            const diff = toolDiff.diff(committed, active);

            if (!toolDiff.hasDiff(diff)) {
              return;
            }

            ctx.ui.notify(`WebMCP tools changed: ${formatDiff(diff)}`, "info");
          }))),
          Stream.runDrain,
          Effect.forkDetach,
        );
      });

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
            yield* disconnect();
            return;
          }

          yield* connect();
        }),
        nudge: () => SubscriptionRef.set(nudges, Symbol()),
      });
    }),
  );

  static readonly live = PiWebMcpCommandService.liveWithoutDependencies.pipe(
    Layer.provide(PiWebMcpToolStateService.live),
    Layer.provide(WebMcpToolsService.live),
    Layer.provide(WebMcpToolDiffService.live),
  );
}
