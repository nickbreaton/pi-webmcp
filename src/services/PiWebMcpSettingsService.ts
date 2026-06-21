import { getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Origin } from "../schemas/WebMcpTool";
import { PiContext } from "./PiApi";

export class PiWebMcpSettings extends Schema.Class<PiWebMcpSettings>("pi-webmcp/PiWebMcpSettings")({
  allowedOrigins: Schema.optionalKey(Schema.Array(Schema.String)),
  disallowedOrigins: Schema.optionalKey(Schema.Array(Schema.String)),
}) { }

class PiSettings extends Schema.Class<PiSettings>("pi-webmcp/PiSettings")({
  webmcp: Schema.optionalKey(PiWebMcpSettings),
}) { }

export class PiWebMcpSettingsService extends Context.Service<PiWebMcpSettingsService, {
  readonly allowedOrigins: Option.Option<ReadonlySet<Origin>>;
  readonly disallowedOrigins: Option.Option<ReadonlySet<Origin>>;
}>()("pi-webmcp/PiWebMcpSettingsService") {
  static readonly live = Layer.effect(
    PiWebMcpSettingsService,
    Effect.gen(function* () {
      const ctx = yield* PiContext;
      const manager = SettingsManager.create(ctx.cwd, getAgentDir());

      const normalizeOrigin = (origin: string): Origin => {
        try {
          const url = new URL(origin.includes("://") ? origin : `https://${origin}`);
          return Schema.decodeSync(Origin)(url.host);
        } catch {
          return Schema.decodeSync(Origin)(origin);
        }
      };

      const normalizeOrigins = (origins: ReadonlyArray<string>): ReadonlySet<Origin> => {
        return new Set(origins.map(normalizeOrigin));
      };

      const globalSettings = yield* Schema.decodeUnknownEffect(PiSettings)(manager.getGlobalSettings());
      const projectSettings = yield* Schema.decodeUnknownEffect(PiSettings)(manager.getProjectSettings());

      const globalWebMcp = globalSettings.webmcp;
      const projectWebMcp = projectSettings.webmcp;

      const allowedOrigins = Option.map(
        Option.fromUndefinedOr(projectWebMcp?.allowedOrigins ?? globalWebMcp?.allowedOrigins),
        (origins) => normalizeOrigins(origins),
      );

      const disallowedOrigins = Option.map(
        Option.fromUndefinedOr(projectWebMcp?.disallowedOrigins ?? globalWebMcp?.disallowedOrigins),
        (origins) => normalizeOrigins(origins),
      );

      return PiWebMcpSettingsService.of({ allowedOrigins, disallowedOrigins });
    }),
  );
}
