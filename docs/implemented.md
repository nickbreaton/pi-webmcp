# Implemented Features

This document tracks features that are currently implemented in this project. It is intentionally limited to behavior present in the codebase.

## Pi Extension

- Registers a Pi extension from `.pi/extensions/webmcp/index.ts` via the `pi.extensions` package configuration.
- Uses Chrome DevTools Protocol through `chrome-remote-interface`.
- Connects to Chrome remote debugging using environment-configurable defaults:
  - `CDP_HOST`, defaulting to `127.0.0.1`
  - `CDP_PORT`, defaulting to `9222`
  - `CDP_WS`, defaulting to `ws://<host>:<port>/devtools/browser`
- Cleans up the browser connection on Pi `session_shutdown`.

## WebMCP Discovery

- Scans open Chrome page targets for WebMCP tools.
- Ignores `chrome://` and `devtools://` targets.
- Attaches to page targets using flattened CDP sessions.
- Enables the DevTools `WebMCP` domain for attached targets.
- Listens for `WebMCP.toolsAdded` events during scans.
- Stores discovered tools in an in-memory registry.
- De-duplicates tools by origin, frame id, and tool name.
- Groups listed tools by origin.
- Supports optional filtering by URL, title, target id, or origin.
- Converts page URLs into origin/host labels for display and tool disambiguation.
- Generates stable pi-facing tool ids from WebMCP tool names.

## Dynamic Monitoring

- Starts target discovery with `Target.setDiscoverTargets` after scanning.
- Attaches to existing page targets when monitoring starts.
- Attaches to newly created page targets while monitoring is active.
- Updates stored target metadata when `Target.targetInfoChanged` fires.
- Listens for live `WebMCP.toolsAdded` events from monitored targets.
- Adds newly announced tools to the registry.
- Sends a custom discovery message when new tools are found.

## Registered Pi Tools

### `webmcp_list`

- Scans open Chrome tabs for WebMCP tools.
- Lists known tools grouped by origin.
- Accepts an optional `filter` parameter.
- Accepts an optional `refresh` parameter.
- Refreshes by default, or reuses the existing registry when `refresh` is `false` and tools are already known.
- Returns both text output and structured tool details.
- Provides custom call/result rendering in the Pi UI.

### `webmcp_describe`

- Resolves a WebMCP tool by pi-facing id or original page-provided name.
- Requires an origin to disambiguate tools from different pages.
- Auto-scans if the registry is empty.
- Returns the tool description.
- Formats the tool input schema, including property names, types/enums, required/optional status, and descriptions.
- Reports ambiguous or missing tools with candidate details.
- Provides custom call/result rendering in the Pi UI.

### `webmcp_execute`

- Resolves a WebMCP tool by pi-facing id or original page-provided name.
- Requires an origin to disambiguate tools from different pages.
- Auto-scans if the registry is empty.
- Accepts optional arguments as a JSON object string.
- Validates that parsed arguments are a JSON object.
- Invokes the page tool through `WebMCP.invokeTool`.
- Waits for `WebMCP.toolResponded`.
- Returns invocation metadata, input, response, and tool details.
- Times out after 60 seconds if the page accepts the invocation but does not respond.
- Provides custom call/result rendering in the Pi UI.

### `webmcp_disconnect`

- Disconnects from Chrome remote debugging.
- Detaches from known CDP target sessions.
- Clears target/session tracking state.
- Clears the in-memory tool registry.
- Returns a confirmation message.

## Registered Pi Command

### `/webmcp`

- Registers a single `/webmcp` command.
- Supports `/webmcp connect`.
- Supports `/webmcp disconnect`.
- Defaults to `connect` when no subcommand is provided.
- Accepts an optional filter after `connect`.
- Shows command argument completions based on connection state:
  - `connect` when disconnected
  - `disconnect` when connected
- Notifies the user when scanning succeeds, disconnects, or fails.

## UI and Model Messaging

- Registers a custom `webmcp-discovery` message renderer.
- Sends hidden/steering discovery messages to the session when new tools are found.
- Discovery messages include tool listings and guidance to use `webmcp_describe` and `webmcp_execute`.
- Discovery message rendering supports expanded and collapsed views.
- Tool renderers use Pi theme colors and keybinding hints.

## Utility Behavior

- Safe tool id generation normalizes names to lowercase alphanumeric/underscore strings.
- Schema formatting supports enum display.
- Tool listings include page title and description when available.
- Browser disconnect resets all CDP session and target maps.
- Browser `disconnect` and `error` events clear cached connection state.
