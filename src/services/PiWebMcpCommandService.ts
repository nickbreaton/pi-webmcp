import { Context, Effect, Layer, Result, Schema, SchemaTransformation, Stream } from "effect";
import { WebMcpTool } from "../schemas/WebMcpTool";
import { BrowserClient } from "./BrowserClient";
import { PiContext } from "./PiApi";
import { PiWebMcpToolStateService } from "./PiWebMcpToolStateService";
import { WebMcpToolsService } from "./WebMcpToolsService";

const Subcommand = Schema.Literals([
  "connect",
  "disconnect",
]);

const CommandArgs = Schema.String.pipe(
  Schema.decode(SchemaTransformation.trim().compose(SchemaTransformation.toLowerCase())),
  Schema.decodeTo(Schema.Literals(["", ...Subcommand.literals])),
);

type PiWebMcpToolDiff = {
  readonly added: WebMcpTool[];
  readonly removed: WebMcpTool[];
};

function stableJson(value: unknown): string {
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toolKey(tool: WebMcpTool) {
  return `${tool.name}::${stableJson(tool.inputSchema)}`;
}

function diffTools(committed: WebMcpTool[], active: WebMcpTool[]): PiWebMcpToolDiff {
  const activeKeys = new Set(active.map(toolKey));
  const committedKeys = new Set(committed.map(toolKey));

  return {
    added: active.filter(tool => !committedKeys.has(toolKey(tool))),
    removed: committed.filter(tool => !activeKeys.has(toolKey(tool))),
  };
}

function hasDiff(diff: PiWebMcpToolDiff) {
  return diff.added.length > 0 || diff.removed.length > 0;
}

function toolName(tool: WebMcpTool) {
  return tool.name;
}

function formatList(items: string[]) {
  return items.length > 0 ? items.join(", ") : "none";
}

function formatDiff(diff: PiWebMcpToolDiff) {
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
}>()("webmcp/PiWebMcpCommandService") {
  static readonly liveWithoutDependencies = Layer.effect(
    PiWebMcpCommandService,
    Effect.gen(function* () {
      const browser = yield* BrowserClient;
      const toolState = yield* PiWebMcpToolStateService;
      const tools = yield* WebMcpToolsService;

      const disconnect = Effect.fn("PiWebMcpCommandService.disconnect")(function* () {
        // TODO: detach active CDP target sessions before disconnecting.
        yield* browser.disconnect().pipe(Effect.ignore);
        yield* toolState.stage([]);
      });

      const connect = Effect.fn("PiWebMcpCommandService.connect")(function* () {
        const ctx = yield* PiContext;

        yield* tools.changes.pipe(
          Stream.tap(active => Effect.gen(function* () {
            yield* toolState.stage(active);

            const committed = yield* toolState.committed;
            const diff = diffTools(committed, active);

            if (!hasDiff(diff)) {
              return;
            }

            ctx.ui.notify(`WebMCP tools changed: ${formatDiff(diff)}`, "info");
          })),
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
      });
    }),
  );

  static readonly live = PiWebMcpCommandService.liveWithoutDependencies.pipe(
    Layer.provide(PiWebMcpToolStateService.live),
    Layer.provide(WebMcpToolsService.live),
  );
}
