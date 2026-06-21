import { Context, Effect, Layer, Option } from "effect";
import { Origin } from "../schemas/WebMcpTool";
import { PiWebMcpSettingsService } from "./PiWebMcpSettingsService";

export class PiWebMcpAllowedOriginService extends Context.Service<PiWebMcpAllowedOriginService, {
  readonly isAllowed: (origin: Origin) => boolean;
}>()("pi-webmcp/PiWebMcpAllowedOriginService") {
  static readonly liveWithoutDependencies = Layer.effect(
    PiWebMcpAllowedOriginService,
    Effect.gen(function*() {
      const settings = yield* PiWebMcpSettingsService;

      const isAllowed = (origin: Origin): boolean => {
        const allowed = Option.match(settings.allowedOrigins, {
          onNone: () => true,
          onSome: (origins) => origins.has(origin),
        });
        const disallowed = Option.match(settings.disallowedOrigins, {
          onNone: () => false,
          onSome: (origins) => origins.has(origin),
        });
        return allowed && !disallowed;
      };

      return PiWebMcpAllowedOriginService.of({ isAllowed });
    }),
  );

  static readonly live = PiWebMcpAllowedOriginService.liveWithoutDependencies.pipe(
    Layer.provide(PiWebMcpSettingsService.live),
  );
}
