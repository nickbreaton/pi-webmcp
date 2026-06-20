import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { NodeHttpServer } from "@effect/platform-node";
import { Context, Crypto, Effect, FileSystem, Layer, Path, Ref, Scope } from "effect";
import { HttpPlatform, HttpServer, HttpServerRequest, HttpServerRespondable, HttpServerResponse, HttpStaticServer } from "effect/unstable/http";
import { PiContext } from "./PiApi";
import { PiWebMcpToolStateService } from "./PiWebMcpToolStateService";

export type PiWebMcpServeParams = {
  readonly path: string;
};

type Mount = {
  readonly id: string;
  readonly root: string;
  readonly kind: "file" | "directory";
  readonly fileName?: string;
};

function withCorsOrigins(
  response: HttpServerResponse.HttpServerResponse,
  allowedOrigins: ReadonlySet<string>,
) {
  return HttpServerResponse.setHeaders(response, {
    "Access-Control-Allow-Origin": [...allowedOrigins].join(", "),
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type, Accept, Origin",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified",
    "Vary": "Origin",
  });
}

export class PiWebMcpServeService extends Context.Service<PiWebMcpServeService, {
  readonly execute: (params: PiWebMcpServeParams) => Effect.Effect<AgentToolResult<unknown>, never, PiContext>;
}>()("pi-webmcp/PiWebMcpServeService") {
  static readonly live = Layer.effect(
    PiWebMcpServeService,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const httpPlatform = yield* HttpPlatform.HttpPlatform;
      const crypto = yield* Crypto.Crypto;
      const piContext = yield* PiContext;
      const toolState = yield* PiWebMcpToolStateService;
      const mountsRef = yield* Ref.make(new Map<string, Mount>());

      const app = Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const stagedTools = yield* toolState.staged;
        const committedTools = yield* toolState.committed;
        const allowedOrigins = new Set([...committedTools, ...stagedTools].map((tool) => `https://${tool.origin}`));

        if (request.method === "OPTIONS") {
          return withCorsOrigins(HttpServerResponse.empty({ status: 204 }), allowedOrigins);
        }

        if (request.method !== "GET" && request.method !== "HEAD") {
          return HttpServerResponse.text("Method not allowed", { status: 405 });
        }

        const url = new URL(request.url, "http://localhost");
        const id = url.pathname.split("/").filter(Boolean)[0];
        const mounts = yield* Ref.get(mountsRef);
        const mount = id ? mounts.get(id) : undefined;

        if (!mount) {
          return withCorsOrigins(HttpServerResponse.text("Not found", { status: 404 }), allowedOrigins);
        }

        const prefix = `/${mount.id}`;
        const suffix = url.pathname === prefix ? "/" : url.pathname.slice(prefix.length);
        let rewrittenUrl: string;

        if (mount.kind === "directory") {
          rewrittenUrl = `${suffix}${url.search}`;
        } else if (suffix === "/" || suffix === "") {
          rewrittenUrl = `/${encodeURIComponent(mount.fileName!)}${url.search}`;
        } else if (decodeURIComponent(suffix.startsWith("/") ? suffix.slice(1) : suffix) === mount.fileName) {
          rewrittenUrl = `${suffix}${url.search}`;
        } else {
          return withCorsOrigins(HttpServerResponse.text("Forbidden", { status: 403 }), allowedOrigins);
        }

        const staticApp = yield* HttpStaticServer.make({ root: mount.root });
        const rewrittenRequest = request.modify({ url: rewrittenUrl });
        const response = yield* staticApp.pipe(
          Effect.provideService(HttpServerRequest.HttpServerRequest, rewrittenRequest),
          Effect.catch((error: unknown) => HttpServerRespondable.toResponseOrElse(error, HttpServerResponse.text("Not found", { status: 404 }))),
        );

        return withCorsOrigins(response, allowedOrigins);
      });

      const startServer = yield* Effect.cached(Effect.gen(function* () {
        const serverContext = yield* Layer.buildWithScope(NodeHttpServer.layerTest, scope);
        const server = Context.get(serverContext, HttpServer.HttpServer);

        yield* server.serve(app).pipe(
          Effect.provideService(FileSystem.FileSystem, fileSystem),
          Effect.provideService(Path.Path, path),
          Effect.provideService(HttpPlatform.HttpPlatform, httpPlatform),
          Effect.provideService(PiContext, piContext),
          Scope.provide(scope),
        );

        if (server.address._tag === "UnixAddress") {
          return yield* Effect.die("webmcp_serve requires a TCP HTTP server address");
        }

        return { origin: `http://localhost:${server.address.port}` };
      }));

      return PiWebMcpServeService.of({
        execute: (params) => Effect.gen(function* () {
          const ctx = yield* PiContext;
          const server = yield* startServer;
          const resolvedPath = path.isAbsolute(params.path)
            ? params.path
            : path.resolve(ctx.cwd, params.path);
          const stat = yield* fileSystem.stat(resolvedPath);

          if (stat.type !== "File" && stat.type !== "Directory") {
            return {
              content: [{ type: "text" as const, text: `Cannot serve ${resolvedPath}: path is not a file or directory.` }],
              details: {},
            };
          }

          const id = yield* crypto.randomUUIDv4;
          const mount: Mount = stat.type === "File"
            ? {
              id,
              root: path.dirname(resolvedPath),
              kind: "file",
              fileName: path.basename(resolvedPath),
            }
            : {
              id,
              root: resolvedPath,
              kind: "directory",
            };

          yield* Ref.update(mountsRef, (mounts) => {
            const next = new Map(mounts);
            next.set(id, mount);
            return next;
          });

          return {
            content: [{
              type: "text" as const,
              text: `Serving ${mount.kind} at ${mount.kind === "file"
                ? `${server.origin}/${id}/${encodeURIComponent(mount.fileName!)}`
                : `${server.origin}/${id}/`}`,
            }],
            details: {},
          };
        }).pipe(
          Effect.catch((cause: unknown) => Effect.succeed({
            content: [{ type: "text" as const, text: `Failed to serve path: ${cause instanceof Error ? cause.message : String(cause)}` }],
            details: {},
          })),
        ),
      });
    }),
  );
}
