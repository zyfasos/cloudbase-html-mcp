# CloudBase HTML MCP

[简体中文 — primary documentation](https://cdn.jsdelivr.net/npm/cloudbase-html-mcp@0.4.0-beta.1/README.md) | English overview

A local STDIO MCP server that lets your desktop AI agent publish a designated HTML file to your CloudBase environment, update the same URL, take a site offline and restore it from a local file.

**0.4.0-beta.1 is a public beta for testing.** Windows and desktop-client acceptance remain pending. Node.js 22+ is required; the package does not bundle Node.

## Setup

Receive a completed `credentials.env` from your administrator and place it at `.config/cloudbase-html-mcp/credentials.env` under your home directory. Then add the MCP using the appropriate client configuration, reload it, and run `hosting_status` and `list_html`. Administrator-issued Keys require no CloudBase login.

- [Getting started (Chinese)](https://cdn.jsdelivr.net/npm/cloudbase-html-mcp@0.4.0-beta.1/docs/getting-started.md): configuration placement, source/local package installation, optional wizard and troubleshooting.
- [Desktop clients (Chinese)](https://cdn.jsdelivr.net/npm/cloudbase-html-mcp@0.4.0-beta.1/docs/clients.md): JSON and command forms for macOS and Windows.
- [Architecture (Chinese)](https://cdn.jsdelivr.net/npm/cloudbase-html-mcp@0.4.0-beta.1/docs/architecture.md): six-tool contracts and lifecycle sequences.

Only one UTF-8 HTML file, up to 5 MiB, is uploaded; associated local assets are not included. Offline operations delete cloud content, and restoration requires the local file and registration. Storage success and public accessibility are reported separately. Setup itself publishes nothing.

The full documentation is maintained in Chinese. This page is a brief overview, not a parallel translation.

## License

[MIT](LICENSE). Dependencies retain their own licenses. This is an independent project, not an official Tencent Cloud product.
