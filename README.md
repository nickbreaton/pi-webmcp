# pi-webmcp

Integrate Pi’s tool-calling abilities with web pages that expose [WebMCP](https://github.com/webmachinelearning/webmcp) tools.

> 🚧 Both the WebMCP specification and Chrome’s implementation are in active development. Anticipate breaking changes that affect this extension.

> ❗This extension can pose a security risk in its default operating mode once the `/webmcp` command is run. A malicious web page could poison the running Pi session’s context via its tool instructions.
>
> Use at your own risk, and consider setting `allowedOrigins` to restrict which pages Pi can connect to.

## First-time Setup

1. Enable Chrome remote debugging by visiting `chrome://inspect/#remote-debugging`.

   ![Chrome remote debugging settings](.github/chrome_enable_remote_debugging.png)

2. Enable the relevant Chrome flags for WebMCP.

   - `chrome://flags/#devtools-webmcp-support`
   - `chrome://flags/#enable-webmcp-testing`

   ![Chrome WebMCP flags](.github/chrome_webmcp_flags.png)

## Usage

1. Run `/webmcp` and accept the once-per-session confirmation prompt in Chrome.

   ![Chrome remote debugging permission prompt](.github/chrome_allow_remote_debugging.png)

2. Navigate to a WebMCP-capable page, such as Chrome Lab’s [WebMCP Travel](https://googlechromelabs.github.io/webmcp-tools/demos/react-flightsearch/) demo.

## Options

| Option | Description |
|--------|-------------|
| allowedOrigins | When specified, Pi will only discover and connect to WebMCP tools from these origins. |
| disallowOrigins | When specified, Pi will not discover or connect to WebMCP tools from these origins. |
