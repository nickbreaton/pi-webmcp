# pi-webmcp

A [Pi](https://pi.dev/) extension that connects Pi to webpages that register [WebMCP](https://github.com/webmachinelearning/webmcp) tools.

> [!IMPORTANT]
>
> Both the WebMCP specification and Chrome’s implementation are in active development. Anticipate breaking changes that affect this extension.

> [!CAUTION]
>
> This extension can pose a security risk in its default operating mode once the `/webmcp` command is run. A malicious webpage could poison the running Pi session’s context via its WebMCP tool instructions.
>
> Use at your own risk. Consider setting `allowedOrigins` to restrict which webpages Pi can connect to.

## First-time Setup

1. Install this extension via npm.

   ```sh
   pi install npm:pi-webmcp
   ```

2. Enable Chrome remote debugging by visiting [`chrome://inspect/#remote-debugging`](chrome://inspect/#remote-debugging).

![Chrome remote debugging settings](https://raw.githubusercontent.com/nickbreaton/pi-webmcp/main/.github/chrome_enable_remote_debugging.png)

3. Enable the relevant Chrome flags for WebMCP.

   - [`chrome://flags/#devtools-webmcp-support`](chrome://flags/#devtools-webmcp-support)
   - [`chrome://flags/#enable-webmcp-testing`](chrome://flags/#enable-webmcp-testing)

![Chrome WebMCP flags](https://raw.githubusercontent.com/nickbreaton/pi-webmcp/main/.github/chrome_webmcp_flags.png)

## Usage

1. Run `/webmcp` and accept the once-per-session confirmation prompt in Chrome.

![Chrome remote debugging permission prompt](https://raw.githubusercontent.com/nickbreaton/pi-webmcp/main/.github/chrome_allow_remote_debugging.png)

2. Navigate to a WebMCP-capable page, such as Chrome Lab’s [WebMCP Travel](https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/) demo.

   More can be found [here](https://github.com/GoogleChromeLabs/webmcp-tools).

### Commands

- `/webmcp` or `/webmcp connect` — Connect to Chrome and discover WebMCP tools.
- `/webmcp disconnect` — Disconnect from Chrome WebMCP.
- `/webmcp list` — Show active WebMCP tools.

## Options

Configure WebMCP options under the `webmcp` key in Pi settings, either globally in `~/.pi/agent/settings.json` or per trusted project in `.pi/settings.json`:

```json
{
  "webmcp": {
    "allowedOrigins": ["googlechromelabs.github.io"]
  }
}
```

| Option                     | Description                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------- |
| `webmcp.allowedOrigins`    | When specified, Pi will only discover and connect to WebMCP tools from these origins. |
| `webmcp.disallowedOrigins` | When specified, Pi will not discover or connect to WebMCP tools from these origins.   |

## Browser Support

WebMCP is currently only implemented in Chrome, so this extension is scoped to Chromium-based browsers for now. We plan to support additional browsers if / when they implement WebMCP.
