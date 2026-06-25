import { Effect, Option, Schema, SchemaIssue, SchemaTransformation } from "effect";

export const CdpUrl = Schema.Union([Schema.Number, Schema.URLFromString]).pipe(
  Schema.decodeTo(
    Schema.URL,
    SchemaTransformation.transformOrFail({
      decode: (cdp) => {
        const url = typeof cdp === "number" ? new URL(`ws://127.0.0.1:${cdp}/devtools/browser`) : cdp;
        return url.protocol === "ws:" || url.protocol === "wss:"
          ? Effect.succeed(url)
          : Effect.fail(new SchemaIssue.InvalidValue(Option.some(url), { message: "CDP URL must use ws:// or wss://" }));
      },
      encode: (url) => Effect.succeed(url),
    }),
  ),
);

export class PiWebMcpSettings extends Schema.Class<PiWebMcpSettings>("pi-webmcp/PiWebMcpSettings")({
  allowedOrigins: Schema.optionalKey(Schema.Array(Schema.String)),
  disallowedOrigins: Schema.optionalKey(Schema.Array(Schema.String)),
  cdp: Schema.optionalKey(CdpUrl),
  otel: Schema.optionalKey(Schema.Union([Schema.URLFromString, Schema.Boolean])),
}) {}

export class PiSettings extends Schema.Class<PiSettings>("pi-webmcp/PiSettings")({
  webmcp: Schema.optionalKey(PiWebMcpSettings),
}) {}
