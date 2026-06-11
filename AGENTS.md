@README.md

@.pi/extensions/webmcp/index.ts will be loaded by Pi as an extension so we can test, but also familiarize yourself with its contents as we may want to modify it.

When interacting with WebMCP pages through Chrome DevTools Protocol, only use the DevTools `WebMCP.*` commands/events. Do not use `Runtime.evaluate` or other CDP commands to inspect, patch, mutate, or execute JavaScript in the page context.

If and only if changes are made to the script or its dependencies do I need to run `/reload` in PI. The user must do this. Trust that the user understands this behavior, lightly prompt after making a change to the script.

Effect runtime boundaries:
- `runtime.runPromise` is allowed in `.pi/extensions/webmcp/index.ts`.
- `runtime.runPromise` is banned in every other file.
- `Effect.runPromise` and `Effect.runFork` are banned everywhere.
