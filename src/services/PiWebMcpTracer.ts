import { Effect, Layer, Option } from "effect";
import { PiWebMcpSettingsService } from "./PiWebMcpSettingsService";

export class PiWebMcpTracer {
  static readonly layer = Layer.unwrap(
    Effect.gen(function*() {
      const settings = yield* PiWebMcpSettingsService;

      if (Option.isNone(settings.otel) || settings.otel.value === false) {
        return Layer.empty;
      }

      const url = settings.otel.value === true
        ? "http://127.0.0.1:4318/v1/traces"
        : settings.otel.value.href;

      const [NodeSdk, { OTLPTraceExporter }, { BatchSpanProcessor }] = yield* Effect.promise(() =>
        Promise.all([
          import("@effect/opentelemetry/NodeSdk"),
          import("@opentelemetry/exporter-trace-otlp-http"),
          import("@opentelemetry/sdk-trace-base"),
        ])
      );

      return NodeSdk.layer(() => ({
        resource: {
          serviceName: "pi-webmcp",
          serviceVersion: "0.2.0",
        },
        spanProcessor: new BatchSpanProcessor(
          new OTLPTraceExporter({ url }),
        ),
      }));
    }),
  );
}
