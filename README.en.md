# CloudBase HTML MCP

[简体中文 — primary documentation](README.md) | English overview

A local STDIO MCP server that lets your desktop AI agent publish a designated HTML file to your CloudBase environment, update the same URL, take a site offline and restore it from a local file.

The motivation is simple: share an agent-generated report, demo or interactive page, keep updating the same link, and take it offline or restore it when needed. The workflow focuses on single HTML files, desktop MCP clients and an administrator-provided configuration file; it needs no separate remote MCP service. See the [scenarios and lifecycle diagram](README.md#典型场景) in the Chinese README.

[CloudBase](https://cloudbase.net/) is Tencent Cloud's application development platform. This tool uses its static hosting and environment authentication for one focused workflow: publishing a single local HTML file to your own environment. Cloud service charges are separate from the MIT-licensed tool. See the [Chinese positioning notes](PROJECT.md#positioning-and-related-tools) for related projects and scope.

**0.4.0-beta.4 is a testing release.** It fixes UTF-8 BOM configuration loading and CLI argument diagnostics, and retains shared-file site management and directory share URLs. WorkBuddy and Qianwen Office onboarding/publishing evidence comes from beta.2; desktop acceptance of beta.4 remains pending. See [verification status](PROJECT.md#v04-验证与发布安排). Node.js 22+ is required; the package does not bundle Node.

## Setup

Receive a completed `credentials.env` from your administrator and place it at `.config/cloudbase-html-mcp/credentials.env` under your home directory. Then add the MCP using the appropriate client configuration, reload it, and run `hosting_status` and `list_html`. Administrator-issued Keys require no CloudBase login.

- [Getting started (Chinese)](docs/getting-started.md): configuration placement, source/local package installation, optional wizard and troubleshooting.
- [Desktop clients (Chinese)](docs/clients.md): JSON and command forms for macOS and Windows.
- [Architecture (Chinese)](docs/architecture.md): six-tool contracts and lifecycle sequences.

Only one UTF-8 HTML file, up to 5 MiB, is uploaded; associated local assets are not included. Offline operations delete cloud content, and restoration requires the local file and registration. Storage success and public accessibility are reported separately. Setup itself publishes nothing.

The full documentation is maintained in Chinese. This page is a brief overview, not a parallel translation.

## License

[MIT](LICENSE). Dependencies retain their own licenses. This is an independent project, not an official Tencent Cloud product.
