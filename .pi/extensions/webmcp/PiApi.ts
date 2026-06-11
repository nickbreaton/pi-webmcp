import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Context } from "effect";

export class PiApi extends Context.Service<PiApi, ExtensionAPI>()("webmcp/PiApi") {}
