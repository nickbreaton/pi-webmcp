import { Context, Effect, Layer, Result, Schema } from "effect";
import { WebMcpTool, type WebMcpToolContainer } from "../schemas/WebMcpTool";
import { BrowserClient, type CdpClient } from "./BrowserClient";

type TargetInfo = { targetId: string; title: string; url: string; type: string };

const WebMcpToolsAddedEvent = Schema.Struct({
  tools: Schema.Array(WebMcpTool),
});

function isPageTarget(target: TargetInfo) {
  return target.type === "page" &&
    !target.url.startsWith("chrome://") &&
    !target.url.startsWith("devtools://");
}

async function getPageTargets(cdp: CdpClient): Promise<TargetInfo[]> {
  const { targetInfos } = await cdp.send("Target.getTargets");
  return targetInfos.filter(isPageTarget);
}

async function scanTarget(cdp: CdpClient, target: TargetInfo): Promise<WebMcpToolContainer[]> {
  const found: WebMcpToolContainer[] = [];
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: true });

  cdp.on("WebMCP.toolsAdded", (event, eventSessionId) => {
    if (eventSessionId !== sessionId) {
      return;
    }

    const result = Schema.decodeUnknownResult(WebMcpToolsAddedEvent)(event);

    if (Result.isFailure(result)) {
      // TODO: bubble up some error
      return;
    }

    for (const tool of result.success.tools) {
      found.push({
        metadata: {
          targetId: target.targetId,
          title: target.title,
          url: target.url,
        },
        tool,
      });
    }
  });

  try {
    await cdp.send("WebMCP.enable", {}, sessionId);
    return found;
  } finally {
    await cdp.send("Target.detachFromTarget", { sessionId });
  }
}

export class ToolScanService extends Context.Service<ToolScanService, {
  readonly scan: Effect.Effect<WebMcpToolContainer[], unknown>;
}>()("webmcp/ToolScanService") {
  static readonly liveWithoutDependencies = Layer.effect(
    ToolScanService,
    Effect.gen(function* () {
      const browser = yield* BrowserClient;

      return ToolScanService.of({
        scan: Effect.gen(function* () {
          const cdp = yield* browser.connect();
          const targets = yield* Effect.tryPromise(() => getPageTargets(cdp));
          const tools = yield* Effect.tryPromise(() => Promise.all(targets.map(target => scanTarget(cdp, target))));
          return tools.flat();
        }),
      });
    }),
  );

  static readonly live = ToolScanService.liveWithoutDependencies.pipe(
    Layer.provide(BrowserClient.live),
  );
}
