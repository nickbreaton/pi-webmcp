import * as NodeSdk from "@effect/opentelemetry/NodeSdk";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { Layer } from "effect";

const defaultExporterUrl = "http://127.0.0.1:27686/v1/traces";

export const PiWebMcpOpenTelemetryLive = process.env.PI_WEBMCP_OTEL_DISABLED === "1"
  ? Layer.empty
  : NodeSdk.layer(() => ({
    resource: {
      serviceName: process.env.PI_WEBMCP_OTEL_SERVICE_NAME?.trim() || "pi-webmcp",
      attributes: {
        "service.namespace": "pi",
        "deployment.environment.name": process.env.NODE_ENV || "development",
      },
    },
    spanProcessor: new BatchSpanProcessor(
      new OTLPTraceExporter({
        url: process.env.PI_WEBMCP_OTEL_EXPORTER_URL?.trim()
          || process.env.MOTEL_OTEL_EXPORTER_URL?.trim()
          || defaultExporterUrl,
      }),
    ),
  }));
