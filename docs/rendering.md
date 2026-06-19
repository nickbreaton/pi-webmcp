# WebMCP Rendering and Context Strategy

## Goals

WebMCP tool-state updates now use the simplest path:

1. **Persist committed tool state** so `/tree`, `/resume`, and normal session replay can reconstruct which WebMCP tools were available at each user-message boundary.
2. **Inform the LLM** about the current WebMCP tools through the system prompt before the agent starts.
3. **Keep user feedback lightweight and continuous** with a notification that remains visible while WebMCP tools are available/changed.
4. **Avoid extra history rendering** for WebMCP diffs. No custom WebMCP message needs to be inserted or rendered.

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

This metadata is for Pi / extension state reconstruction. It is not rendered as a separate message and is not the mechanism used to brief the LLM.

## LLM-visible tool state

Before the agent starts, inject the current staged WebMCP tool list into the system prompt.

Conceptually:

```ts
pi.on("before_agent_start", async (event) => {
  const tools = await getStagedWebMcpTools();

  return {
    systemPrompt:
      event.systemPrompt +
      `\n\nAvailable WebMCP tools: ${tools.map((tool) => tool.name).join(", ")}`,
  };
});
```

This means the LLM learns the current WebMCP tool availability directly from the provider request setup. There is no need for synthetic history messages, custom context cleanup, or custom WebMCP message rendering.

## User-visible feedback

The `/webmcp connect` flow listens to active WebMCP tool changes, stages the active tool list, compares it to the committed tool snapshot, and emits a Pi notification when that diff is non-empty.

The notification text is:

```text
WebMCP tools changed: new: <added tool names>; removed: <removed tool names>
```

Only non-empty sections are included, so an add-only change reports `new: ...` and a remove-only change reports `removed: ...`.

That notification is the user-facing record of the change. The extension does not create an additional committed custom message for the visible history.

## Commit flow

```text
Browser WebMCP events update staged tool state
        │
        ▼
Extension computes staged/current tool availability
        │
        ├─ if staged-vs-committed diff is non-empty, emit Pi notification
        │
        ▼
User sends message
        │
        ├─ attach committed tool snapshot to user message details
        │
        └─ before agent starts, inject available WebMCP tools into system prompt
        │
        ▼
LLM sees current WebMCP tool availability from the system prompt
```

## Responsibilities by mechanism

| Mechanism | Purpose | Persistent | LLM-visible | User-visible |
| --- | --- | --- | --- | --- |
| User message `details.webmcp.tools` | Committed snapshot / reconstruction | Yes | No | No |
| `before_agent_start` system prompt injection | Tell LLM current WebMCP tools | No | Yes | No |
| Pi notification | User-facing non-empty staged-vs-committed tool diff | Runtime/UI state | No | Yes |
