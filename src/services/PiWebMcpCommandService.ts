import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer } from "@earendil-works/pi-tui";
import { Context, Effect, Layer, Option, Ref, Result, Schema, SchemaTransformation, Stream, SubscriptionRef } from "effect";
import { BrowserClient } from "./BrowserClient";
import { PiContext } from "./PiApi";
import { PiTurnRefService } from "./PiTurnRefService";
import { PiWebMcpAllowedOriginService } from "./PiWebMcpAllowedOriginService";
import { PiWebMcpListService } from "./PiWebMcpListService";
import { PiWebMcpListWidgetService } from "./PiWebMcpListWidgetService";
import { PiWebMcpToolStateService } from "./PiWebMcpToolStateService";
import { WebMcpToolDiff, WebMcpToolDiffService } from "./WebMcpToolDiffService";
import { WebMcpToolsService } from "./WebMcpToolsService";

const Subcommand = Schema.Literals([
  "connect",
  "disconnect",
  "list",
]);

const CommandArgs = Schema.String.pipe(
  Schema.decode(SchemaTransformation.trim().compose(SchemaTransformation.toLowerCase())),
  Schema.decodeTo(Schema.Literals(["", ...Subcommand.literals])),
);

function formatAddedOrigins(diff: WebMcpToolDiff) {
  const counts = new Map<string, number>();

  for (const tool of diff.added) {
    counts.set(tool.origin, (counts.get(tool.origin) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([origin, count]) => `${origin} [${count}]`)
    .join(", ");
}

export class PiWebMcpCommandService extends Context.Service<PiWebMcpCommandService, {
  readonly handle: (args: string) => Effect.Effect<void, never, PiContext>;
  readonly nudge: () => Effect.Effect<void>;
}>()("pi-webmcp/PiWebMcpCommandService") {
  static readonly liveWithoutDependencies = Layer.effect(
    PiWebMcpCommandService,
    Effect.gen(function*() {
      const browser = yield* BrowserClient;
      const listWidget = yield* PiWebMcpListWidgetService;
      const toolState = yield* PiWebMcpToolStateService;
      const listService = yield* PiWebMcpListService;
      const tools = yield* WebMcpToolsService;
      const allowedOrigin = yield* PiWebMcpAllowedOriginService;
      const toolDiff = yield* WebMcpToolDiffService;
      const turnRefService = yield* PiTurnRefService;
      const notificationShownRef = yield* turnRefService.make(Option.some(true));
      const nudges = yield* SubscriptionRef.make<unknown>(null);

      const disconnect = Effect.fn("PiWebMcpCommandService.disconnect")(function*() {
        yield* listWidget.clear();
        // TODO: detach active CDP target sessions before disconnecting.
        yield* browser.disconnect().pipe(Effect.ignore);
        yield* toolState.stage([]);
      });

      const list = Effect.fn("PiWebMcpCommandService.list")(function*() {
        const ctx = yield* PiContext;
        const cdp = yield* browser.get;

        if (Option.isNone(cdp)) {
          ctx.ui.notify("WebMCP: Not connected. Run `/webmcp` first.", "error");
          return;
        }

        const text = yield* listService.markdown({});

        if (Option.isNone(text)) {
          ctx.ui.notify("WebMCP: No tools discovered.", "info");
          return;
        }

        const markdownTheme = getMarkdownTheme();

        yield* listWidget.set(() => {
          const widget = new Container();
          widget.addChild(new Markdown(text.value, 0, 0, markdownTheme));
          widget.addChild(new Spacer(1));
          return widget;
        });
      });

      const connect = Effect.fn("PiWebMcpCommandService.connect")(function*() {
        const ctx = yield* PiContext;

        yield* listWidget.clear();

        const connected = yield* browser.connect({ force: true }).pipe(
          Effect.as(true),
          Effect.catchTag(
            "BrowserClientError",
            Effect.fn("PiWebMcpCommandService.connect.handleBrowserClientError")(function*() {
              ctx.ui.notify("WebMCP: Failed to connect to Chrome. Make sure Chrome is open with remote debugging enabled.", "error");
              return false;
            }),
          ),
        );

        if (!connected) return;

        yield* tools.changes.pipe(
          Stream.map((tools) => tools.filter((tool) => allowedOrigin.isAllowed(tool.origin))),
          Stream.zipLatestWith(SubscriptionRef.changes(nudges), (tools) => tools),
          // Stage every change immediately so the registry stays current.
          Stream.tap((active) => toolState.stage(active)),
          // Only notify for the latest change once the agent is idle. If a
          // newer change arrives while we're waiting, `switchMap` interrupts
          // the pending notification and restarts with the latest state,
          // preventing a backlog of queued notifications.
          Stream.switchMap((active) =>
            Stream.fromEffectDrain(Effect.gen(function*() {
              yield* Effect.promise(() => ctx.waitForIdle());

              const committed = yield* toolState.committed;
              const diff = toolDiff.diff(committed, active);

              const notificationShown = yield* Ref.get(notificationShownRef).pipe(
                Effect.map(Option.getOrElse(() => false)),
              );

              if (!toolDiff.hasDiff(diff) && notificationShown) {
                ctx.ui.notify("");
                return;
              }

              if (diff.added.length === 0) {
                return;
              }

              yield* Ref.set(notificationShownRef, Option.some(true));

              ctx.ui.notify(`WebMCP: New tool(s) discovered for ${formatAddedOrigins(diff)}.`, "info");
            }))
          ),
          Stream.runDrain,
          Effect.forkDetach,
        );
      });

      return PiWebMcpCommandService.of({
        handle: Effect.fn("PiWebMcpCommandService.handle")(function*(args: string) {
          const ctx = yield* PiContext;

          const result = Schema.decodeUnknownResult(CommandArgs)(args);

          if (Result.isFailure(result)) {
            ctx.ui.notify(`Usage: /webmcp [${Subcommand.literals.join("|")}]`, "error");
            return;
          }

          const command = result.success;

          if (command === "disconnect") {
            return yield* disconnect();
          }

          if (command === "list") {
            return yield* list();
          }

          yield* connect();
        }),
        nudge: Effect.fn("PiWebMcpCommandService.nudge")(function*() {
          yield* SubscriptionRef.set(nudges, Symbol());
        }),
      });
    }),
  );

  static readonly live = PiWebMcpCommandService.liveWithoutDependencies.pipe(
    Layer.provide(PiWebMcpListService.live),
    Layer.provide(PiWebMcpToolStateService.live),
    Layer.provide(WebMcpToolsService.live),
    Layer.provide(PiTurnRefService.live),
    Layer.provide(PiWebMcpAllowedOriginService.live),
    Layer.provide(WebMcpToolDiffService.live),
  );
}
