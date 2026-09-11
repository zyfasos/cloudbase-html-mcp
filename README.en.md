# CloudBase HTML MCP

[简体中文 — primary documentation](README.md) | English overview

A local STDIO MCP server that lets your AI agent publish a designated HTML file to your CloudBase environment, update the same URL, take a site offline and restore it from a local file.

The motivation is simple: share an agent-generated report, demo or interactive page, keep updating the same link, and take it offline or restore it when needed. The workflow focuses on single HTML files and agents that can launch a local STDIO MCP server. Configure your own CloudBase environment or receive a completed configuration file from an administrator; no separate remote MCP service or application database is required. See the [scenarios and lifecycle diagram](README.md#典型场景) in the Chinese README.

[CloudBase](https://cloudbase.net/) is Tencent Cloud's application development platform. This tool uses its static hosting and environment authentication for one focused workflow: publishing a single local HTML file to your own environment. Cloud service charges are separate from the MIT-licensed tool. See the [Chinese positioning notes](PROJECT.md#positioning-and-related-tools) for related projects and scope.

<!-- release:version -->
**Prerelease version: 0.5.0-beta.1.** Node.js 22+ is required; the package does not bundle Node. Release and acceptance evidence is recorded in [verification status](PROJECT.md#v05-release). Earlier desktop evidence does not establish acceptance of a newer version.
<!-- /release:version -->

This release adds optional site names, HTML titles and local keyword search, plus structured static-resource diagnostics on publish/restore. It still uploads only the original HTML. **Available on npm under the beta tag**; use the pinned version in the client configuration. See the [Chinese guide](docs/getting-started.md#resource-diagnostics) for scope and upgrade notes.

## Workflow

![HTML publishing lifecycle: publish or update a local HTML file to an online page; taking it offline deletes cloud content but keeps the local registration; restoring it requires a specified local file.](docs/images/html-lifecycle.en.png)

`publish_html` publishes or updates an online page; `offline_html` deletes cloud content while keeping its registration; `online_html` restores the site from the file you specify. Updates and restoration keep the original URL when the domain mapping is unchanged. Editing the local file alone does not update the online page.

## Setup

Prepare `credentials.env` for your own environment or receive it from your administrator. Place it at `.config/cloudbase-html-mcp/credentials.env` under the home directory of the user running the MCP process. Then add the MCP using the appropriate client configuration, reload it, and run `hosting_status` and `list_html`. Administrator-issued Keys require no CloudBase login. Let your agent help with setup or configure it manually. The configuration and HTML must be accessible where the MCP runs; remote/container setups need their own path mapping and verification.

- [Getting started (Chinese)](docs/getting-started.md): configuration placement, source/local package installation, optional wizard and troubleshooting.
- [Agent integrations (Chinese)](docs/clients.md): CLI, IDE and desktop configuration forms, with documented examples separated from tested compatibility.
- [Architecture (Chinese)](docs/architecture.md): six-tool contracts and lifecycle sequences.

Only one UTF-8 HTML file, up to 20 MiB, is uploaded; associated local assets are not included. Offline operations delete cloud content, and restoration requires the local file and registration. Storage success and public accessibility are reported separately. Setup itself publishes nothing.

“Lightweight” describes the focused workflow, not a measured advantage in installation size, speed or token use. Multiple users can use one environment, but site catalogs and search remain local; this is not a shared team catalog.

The full documentation is maintained in Chinese. This page is a brief overview, not a parallel translation.

## License

[MIT](LICENSE). Dependencies retain their own licenses. This is an independent project, not an official Tencent Cloud product.
