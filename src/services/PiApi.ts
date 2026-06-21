import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Context } from "effect";

export class PiApi extends Context.Service<PiApi, ExtensionAPI>()("pi-webmcp/PiApi") {}

export class PiContext extends Context.Service<PiContext, ExtensionCommandContext>()("pi-webmcp/PiContext") {}
