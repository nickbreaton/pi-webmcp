import { Context, Layer } from "effect";

export class PiWebMcpResponseService extends Context.Service<PiWebMcpResponseService, {
  readonly connectInstruction: string;
}>()("webmcp/PiWebMcpResponseService") {
  static readonly live = Layer.succeed(
    PiWebMcpResponseService,
    PiWebMcpResponseService.of({
      connectInstruction: "WebMCP is not connected to Chrome. Ask the user to run `/webmcp` before using WebMCP tools.",
    }),
  );
}
