# pi-webmcp

A small pi extension that discovers [WebMCP](https://github.com/webmachinelearning/webmcp) tools exposed by open Chrome tabs and registers them as callable pi tools.

## Intent

WebMCP lets a web page expose page-specific tools through the Chrome DevTools Protocol. This project bridges those tools into pi so an assistant can:

- scan open browser tabs for WebMCP-capable pages
- dynamically register discovered page tools
- invoke those tools from the normal pi tool-calling flow

The extension keeps browser interaction page-scoped: discovered tools include their originating target/frame metadata, and registered tool prompts instruct the assistant to use them only for the page that exposed them.

## Usage

Load the extension in pi, then scan Chrome for WebMCP tools:

```text
/webmcp-scan
```

Or ask the assistant to use the registered scanner tool:

```text
Scan open Chrome tabs for WebMCP tools
```

After scanning, discovered tools are registered with names like:

```text
webmcp_<tool_name>
```

## Configuration

The extension connects to Chrome's browser-level CDP WebSocket endpoint. Defaults:

```text
CDP_HOST=127.0.0.1
CDP_PORT=9222
CDP_WS=ws://127.0.0.1:9222/devtools/browser
```

Override these environment variables if Chrome is listening elsewhere.

## Development

Run TypeScript checks with:

```bash
npm run typecheck
```
