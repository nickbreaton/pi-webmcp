> [!NOTE]
> The following plan is agent generated and should be taken loosely. It's intent is to capture overall goal of the project and define potential features and their edge cases. It should not be taken as as a final or complete specification.

# WebMCP Connection Requirements for Pi

## 1. Purpose

Add a WebMCP integration to Pi that lets a user connect a Pi session to browser-provided tools.

The connection should be explicit by default. Browser tools should not become available unless the user connects WebMCP or enables an opt-in auto-connect setting.

## 2. Core Flow

### Connect

The user runs:

```text
/webmcp connect
```

When this happens:

1. Pi establishes the WebMCP connection.
2. Pi discovers tools currently available from the connected browser context.
3. Pi applies the configured origin filters.
4. Allowed tools become available to the model.
5. Pi may need to notify the model/session that WebMCP is connected and that the available tools have changed.

### Disconnect

The user runs:

```text
/webmcp disconnect
```

When this happens:

1. Pi disconnects from WebMCP.
2. WebMCP-provided tools should no longer be available to the model.
3. Pi may need to notify the model/session that WebMCP is disconnected and that the available tools have changed.
4. The system should avoid leaving stale WebMCP tools registered after disconnect.

## 3. Command Visibility

Ideally, Pi should expose the relevant command based on connection state.

When disconnected, show:

```text
/webmcp connect
```

When connected, show:

```text
/webmcp disconnect
```

If conditional command visibility is not supported, a single toggle-style command could be considered, but explicit connect/disconnect commands are preferred.

## 4. Auto-Connect Option

The extension should include an optional setting:

```text
Auto-Connect
```

Default:

```text
Off
```

When Auto-Connect is off:

1. Pi does not connect to WebMCP automatically.
2. The user must explicitly run `/webmcp connect`.

When Auto-Connect is on:

1. Pi may automatically start the WebMCP connection flow when Pi starts or resumes.
2. The setting should clearly explain that enabling it may trigger a browser prompt as soon as Pi starts.
3. Auto-Connect should remain opt-in.
4. Manual disconnect should still be available.

Explicit connection remains the preferred default behavior.

## 5. Origin Filtering

The extension should support simple origin-based filtering for WebMCP tool discovery.

Users should be able to configure:

1. Allowed origins.
2. Blocked origins.

During discovery, Pi should only expose tools from origins permitted by the user’s configuration.

This should be a straightforward filter on discovery, not a complex trust or permissions system.

Expected behavior:

1. If an origin is blocked, tools from that origin are not exposed.
2. If allowed origins are configured, only matching origins can expose tools.
3. If no allowed origins are configured, tools may be discovered unless blocked.
4. Origin filtering should apply both during initial discovery and dynamic updates.

## 6. Dynamic Tool Discovery

Tool discovery should happen once on connect.

Preferred flow:

```text
connect → initial discovery → dynamic updates while connected → disconnect → tools removed
```

After the initial discovery, Pi should rely on live tool registration/unregistration events if available.

This avoids requiring the user to repeatedly run discovery manually.

## 7. Model Awareness

Because connect and disconnect are user-triggered actions, Pi may need to explicitly update the model/session when they occur.

After connect, the model/session may need to know that:

1. WebMCP is connected.
2. New browser tools are available.
3. The available tool list has changed.

After disconnect, the model/session may need to know that:

1. WebMCP is disconnected.
2. Browser tools are no longer available.
3. Previously available WebMCP tools should not be used.

## 8. Quitting Pi / Resuming a Session

If the user quits Pi, the WebMCP connection should disconnect.

If the user later resumes the same session, the prior WebMCP connection should not be assumed to still exist.

Preferred default behavior:

1. Pi should not silently reconnect WebMCP on resume.
2. The model/session should not assume previous WebMCP tools are still available.
3. The user should explicitly reconnect, unless Auto-Connect is enabled.
4. Pi may need to notify the model/session that WebMCP is not connected after resume.

## 9. Fast Disconnect / Stale Tool Edge Case

There may be an edge case where Pi quits or disconnects before WebMCP tools are cleanly unregistered.

The system should guard against stale tools.

On restart or resumed session:

1. WebMCP tools from the prior connection should not be treated as valid.
2. Any stale registered tools should be cleared.
3. The model/session may need to be told that those tools are unavailable.
4. WebMCP tools should become available again only after reconnecting, either manually or through Auto-Connect if enabled.

## 10. Pi Behavior to Verify

Before adding custom lifecycle logic, verify what Pi already handles.

Open implementation questions:

1. Does Pi automatically notify the model/session when tools are registered?
2. Does Pi automatically notify the model/session when tools are unregistered?
3. Does Pi clear extension-provided tools when the extension disconnects?
4. Does Pi clear tool state when quitting or resuming a session?
5. Can command visibility depend on extension state?
6. Does WebMCP provide live registration/unregistration events, or does Pi need to poll/rediscover?
7. What is the best hook for Auto-Connect on Pi start or session resume?

## 11. Requirements Summary

1. WebMCP connection is initiated with `/webmcp connect`.
2. WebMCP disconnection is initiated with `/webmcp disconnect`.
3. Browser tools should only be available after WebMCP connects.
4. Browser tools should be unavailable after WebMCP disconnects.
5. Auto-Connect may connect automatically only when the user has opted in.
6. Auto-Connect should be off by default.
7. Auto-Connect should clearly warn that it may trigger a browser prompt when Pi starts.
8. Origin allow/block filtering should control which browser origins can expose tools.
9. Tool discovery should happen on connect.
10. Dynamic tool updates should be supported while connected, if available.
11. Pi may need to explicitly notify the model/session when connect or disconnect occurs.
12. Quitting Pi should disconnect WebMCP.
13. Resuming a session should not silently assume WebMCP is still connected.
14. Stale tools should not remain usable after quit, disconnect, or fast shutdown.
15. Check what Pi already handles before adding custom lifecycle behavior.
