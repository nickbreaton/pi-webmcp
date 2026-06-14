# WebMCP Rendering and Context Strategy

## Goals

WebMCP tool-state updates need to satisfy four separate concerns:

1. **Persist state for branch reconstruction** so `/tree`, `/resume`, and normal session replay know what tools were committed at a point in history.
2. **Inform the LLM** when available WebMCP tools change.
3. **Show a clear user-facing diff** when a tool-state change is committed with a user message.
4. **Avoid duplicate or stale WebMCP messages** in both the visible history and the LLM feed.

## Session state

When a user message is finalized, attach the committed WebMCP tool snapshot to the user message `details`.

The user message details are the durable source of truth for the committed WebMCP tool state:

```ts
{
  details: {
    webmcp: {
      tools: [...]
    }
  }
}
```

This metadata is for Pi / extension state reconstruction. It is not intended to be shown directly to the LLM.

## LLM-visible WebMCP messages

When a pending tool-state diff is committed by a user message, insert a custom WebMCP message into history.

This custom message should:

- use `customType: "webmcp"`
- include LLM-readable `content` describing the diff
- include `details` with the structured diff
- be visible for now, because it is the user-facing record of what changed

Example shape:

```ts
{
  customType: "webmcp",
  content: discoveryContent(diff),
  display: true,
  details: {
    added: diff.added,
    removed: diff.removed
  }
}
```

The custom message is how the LLM learns about newly available or removed tools. The user message `details` remain the committed snapshot for reconstruction.

## Context cleanup

Listen to the `context` event and clean up duplicate WebMCP messages in the feed passed to the LLM.

If two `webmcp` custom messages appear consecutively in the context feed, remove the earlier one and keep the later one.

Desired behavior:

```text
webmcp diff A
webmcp diff B
user message
```

becomes:

```text
webmcp diff B
user message
```

This avoids stale adjacent WebMCP announcements after `/tree` navigation or repeated pre-user-message commits.

The cleanup is context-only: it should not rewrite the session file. It only controls what the current provider request sees.

## Visible history rendering

Register a custom renderer for `customType: "webmcp"`.

Normal committed WebMCP messages should render as a concise diff summary, with expanded detail available from `message.details`.

However, if a WebMCP custom message is the most recent item in the visible feed and there is no following user message yet, render it as hidden / empty. This prevents the user from seeing a duplicated or premature message while the message has not yet been anchored by a user prompt.

In other words:

- **WebMCP message followed by a user message**: show the committed diff.
- **WebMCP message at the end of the feed**: hide it with the custom renderer.

## Pending changes before commit

Before the user sends a message, pending WebMCP diffs are not committed to history.

While the user is still typing or the diff is otherwise pending, show the change with a notification / widget instead of inserting a custom message.

This keeps the history clean until there is a real user-message boundary to commit against.

## Commit flow

```text
Browser WebMCP events update staged tool state
        │
        ▼
Extension computes staged-vs-committed diff
        │
        ▼
If user has not committed a message yet:
  show notification / widget only
        │
        ▼
User sends message
        │
        ├─ attach committed tool snapshot to user message details
        │
        └─ insert visible custom webmcp message containing the diff
        │
        ▼
Context hook removes adjacent duplicate webmcp messages from LLM feed
        │
        ▼
LLM sees one current WebMCP diff message plus the user message
```

## Responsibilities by mechanism

| Mechanism | Purpose | Persistent | LLM-visible | User-visible |
| --- | --- | --- | --- | --- |
| User message `details.webmcp.tools` | Committed snapshot / reconstruction | Yes | No | No |
| Custom `webmcp` message `content` | Tell LLM about the diff | Yes | Yes | Yes, unless renderer hides it |
| Custom `webmcp` message `details` | Structured diff for renderer/state | Yes | No | Renderer-dependent |
| `context` hook | Remove duplicate/stale feed entries | No | Affects current request | No |
| Notification/widget | Pending pre-commit user feedback | No | No | Yes |

## Open implementation notes

- The tool-state service should reconstruct committed state from user message `details.webmcp.tools`.
- WebMCP custom messages should represent diffs, not the full committed snapshot.
- The context cleanup should be conservative and only remove adjacent duplicate `webmcp` messages unless a stronger stale-message rule is explicitly needed later.
- The renderer needs enough context to decide whether a WebMCP message is the most recent visible item. If the renderer API cannot determine that directly, prefer `display: false` for unanchored/pre-commit messages and only send visible messages at commit time.
