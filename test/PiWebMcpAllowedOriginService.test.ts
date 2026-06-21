import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import { Origin } from "../src/schemas/WebMcpTool";
import { PiWebMcpAllowedOriginService } from "../src/services/PiWebMcpAllowedOriginService";
import { PiWebMcpSettingsService } from "../src/services/PiWebMcpSettingsService";

const origin = (value: string): Origin => Schema.decodeSync(Origin)(value);

const makeSettingsLayer = (
  allowedOrigins: Option.Option<ReadonlySet<Origin>>,
  disallowedOrigins: Option.Option<ReadonlySet<Origin>>,
): Layer.Layer<PiWebMcpSettingsService> =>
  Layer.succeed(
    PiWebMcpSettingsService,
    PiWebMcpSettingsService.of({ allowedOrigins, disallowedOrigins }),
  );

describe("PiWebMcpAllowedOriginService", () => {
  it.effect("allows any origin when no allow/deny lists are configured", () =>
    Effect.gen(function*() {
      const service = yield* PiWebMcpAllowedOriginService;
      expect(service.isAllowed(origin("example.com"))).toBe(true);
    }).pipe(
      Effect.provide(
        PiWebMcpAllowedOriginService.liveWithoutDependencies.pipe(
          Layer.provide(makeSettingsLayer(Option.none(), Option.none())),
        ),
      ),
    ));

  it.effect("rejects origins outside the allow list", () =>
    Effect.gen(function*() {
      const service = yield* PiWebMcpAllowedOriginService;
      expect(service.isAllowed(origin("example.com"))).toBe(true);
      expect(service.isAllowed(origin("evil.com"))).toBe(false);
    }).pipe(
      Effect.provide(
        PiWebMcpAllowedOriginService.liveWithoutDependencies.pipe(
          Layer.provide(
            makeSettingsLayer(
              Option.some(new Set([origin("example.com")])),
              Option.none(),
            ),
          ),
        ),
      ),
    ));

  it.effect("rejects disallowed origins even when they appear in the allow list", () =>
    Effect.gen(function*() {
      const service = yield* PiWebMcpAllowedOriginService;
      expect(service.isAllowed(origin("evil.com"))).toBe(false);
    }).pipe(
      Effect.provide(
        PiWebMcpAllowedOriginService.liveWithoutDependencies.pipe(
          Layer.provide(
            makeSettingsLayer(
              Option.some(new Set([origin("example.com"), origin("evil.com")])),
              Option.some(new Set([origin("evil.com")])),
            ),
          ),
        ),
      ),
    ));
});
