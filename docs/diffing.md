# Plan

## Pi WebMCP tool-state loop

### Core state

- **Browser active state**: the latest live WebMCP tools currently available in the browser.
- **Pi committed state**: the WebMCP tools Pi/the model has already been told about in session state.
- **Pi staged state**: the latest browser active state captured by Pi, waiting to be committed at a turn boundary.
- **Pending diff**: browser active state diffed against Pi committed state.

Pending diff is **not** current browser state diffed against the previous browser update.

### Desired loop

```text
Browser WebMCP events update active tool state
        │
        ▼
Pi stages latest active browser tools
        │
        ▼
Pi diffs staged/active tools against committed tools
        │
        ▼
If diff exists, notify about pending new/removed tools
        │
        ▼
User sends a message / Pi turn boundary occurs
        │
        ▼
Pi commits staged active tools into session-visible state
        │
        ▼
Pending diff clears
```

### Scenario: first startup before any Pi turn

```text
Pi committed:   []
Browser active: []
Notification:   none
```

Browser opens tabs and registers tools:

```text
Pi committed:   []
Browser active: [A, B, C]

Pending diff:
  new:     A, B, C
  removed: none

Notification:
  New tools: A, B, C
```

At the next user message / turn boundary:

```text
Pi committed := Browser active

Pi committed:   [A, B, C]
Browser active: [A, B, C]
Pending diff:   none
Notification:   none
```

### Scenario: new tools after a Pi turn

After a turn has committed the first tools:

```text
Pi committed:   [A, B, C]
Browser active: [A, B, C]
Notification:   none
```

A new browser tab registers tools `D` and `E`:

```text
Pi committed:   [A, B, C]
Browser active: [A, B, C, D, E]

Pending diff:
  new:     D, E
  removed: none

Notification:
  New tools: D, E
```

### Scenario: committed tools are removed before the next turn

Before the user sends another message, an existing committed tool disappears:

```text
Pi committed:   [A, B, C]
Browser active: [A, C, D, E]

Pending diff:
  new:     D, E
  removed: B

Notification:
  New tools: D, E
  Removed tools: B
```

`B` is shown as removed because Pi had already committed it.

### Scenario: uncommitted new tools disappear before the next turn

If a newly discovered but uncommitted tool disappears before the next user message:

```text
Pi committed:   [A, B, C]
Browser active: [A, C, E]

Pending diff:
  new:     E
  removed: B

Notification:
  New tools: E
  Removed tools: B
```

The disappeared tool `D` is not shown as removed because Pi never committed it.

### Current implementation direction

- `WebMcpToolsService` owns the live browser-active stream.
- `PiWebMcpToolStateService` owns Pi-facing staged/committed state.
- `PiWebMcpCommandService` currently computes the pending diff between live active tools and committed tools.
- Tool moves are intentionally ignored for now; a same logical tool in a different frame may appear as removed plus added until a future move-aware model is needed.
