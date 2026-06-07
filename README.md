# pi-webmcp

A small pi extension that discovers [WebMCP](https://github.com/webmachinelearning/webmcp) tools exposed by open Chrome tabs and registers them as callable pi tools.

## Intent

WebMCP lets a web page expose page-specific tools through the Chrome DevTools Protocol. This project bridges those tools into pi so an assistant can:

- scan open browser tabs for WebMCP-capable pages
- dynamically register discovered page tools
- invoke those tools from the normal pi tool-calling flow
