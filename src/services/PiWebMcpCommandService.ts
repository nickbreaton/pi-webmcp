import { Context, Effect, Layer, Ref, Result, Schema, SchemaTransformation, Stream } from "effect";
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
  return `${tool.frameId}::${tool.name}::${stableJson(tool.inputSchema)}`;
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

function diffSignature(diff: PiWebMcpToolDiff) {
  return [
    ...diff.added.map(tool => `+${toolKey(tool)}`),
    ...diff.removed.map(tool => `-${toolKey(tool)}`),
  ].sort().join("\n");
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
      const latestTools = yield* Ref.make<WebMcpTool[]>([]);
      const lastNotifiedDiff = yield* Ref.make("");
      const monitoring = yield* Ref.make(false);

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
            yield* Ref.set(monitoring, false);
            yield* Ref.set(latestTools, []);
            yield* Ref.set(lastNotifiedDiff, "");
            yield* toolState.stage([]);
            ctx.ui.notify("WebMCP disconnected from Chrome.", "info");
            return;
          }

          const alreadyMonitoring = yield* Ref.get(monitoring);

          if (alreadyMonitoring) {
            const current = yield* Ref.get(latestTools);
            ctx.ui.notify(`WebMCP already connected. Current tools: ${formatList(current.map(toolName))}`, "info");
            return;
          }

          yield* Ref.set(monitoring, true);

          yield* tools.changes.pipe(
            Stream.tap(active => Effect.gen(function* () {
              yield* toolState.stage(active);
              yield* Ref.set(latestTools, active);

              const committed = yield* toolState.committed;
              const diff = diffTools(committed, active);

              if (!hasDiff(diff)) {
                yield* Ref.set(lastNotifiedDiff, "");
                return;
              }

              const signature = diffSignature(diff);
              const previousSignature = yield* Ref.get(lastNotifiedDiff);
              if (signature === previousSignature) {
                return;
              }

              yield* Ref.set(lastNotifiedDiff, signature);
              ctx.ui.notify(`WebMCP tools changed: ${formatDiff(diff)}`, "info");
            })),
            Stream.runDrain,
            Effect.ensuring(Ref.set(monitoring, false)),
            Effect.forkDetach,
          );
        }),
      });
    }),
  );

  static readonly live = PiWebMcpCommandService.liveWithoutDependencies.pipe(
    Layer.provide(PiWebMcpToolStateService.live),
    Layer.provide(WebMcpToolsService.live),
  );
}
