# CloudBase HTML MCP

English | [简体中文](README.zh-CN.md)

Publish a local HTML file to your own CloudBase environment through your AI agent. Get a shareable URL, update the same page, and take it offline or restore it from a local file.

**v0.3.0** · Local STDIO MCP · Six tools · MIT · No CloudBase CLI or full plugin required.

## Quick start

You need **Node.js 22+**, a client supporting local STDIO MCP, and a CloudBase environment with static hosting enabled. Prepare its **environment ID, region and server-side environment API Key**. Recipients of an administrator-issued Key do not need a CloudBase login. Starting from scratch? See [CloudBase preparation](docs/getting-started.md#new-to-cloudbase).

### Let your agent set it up

Copy this request to your local coding agent:

> Read https://raw.githubusercontent.com/zyfasos/cloudbase-html-mcp/main/docs/getting-started.md and install and register cloudbase_html in my MCP client. Reuse existing setup and administrator-provided connection information. Have me enter the API Key in the local terminal wizard, not in chat. Ask together for missing client or non-secret connection information. Verify the connection without publishing a page.

### Install manually

For a new installation, run these commands in your chosen parent directory. Reuse an existing checkout if you have one.

```sh
git clone https://github.com/zyfasos/cloudbase-html-mcp.git
cd cloudbase-html-mcp
npm ci --ignore-scripts
npm run setup
```

The wizard asks for connection details, hides Key input, and runs a read-only check. It saves credentials in a private file outside Git and prints JSON/TOML client configuration without the Key. Merge that entry into your client, reload it, and call `hosting_status`. Setup is complete when all six tools are available and that call succeeds.

See [Getting started](docs/getting-started.md) for configuration examples and troubleshooting. Installation is from source; no npm package is published.

Once connected, ask your agent to publish a file you choose:

> Publish `/absolute/path/report.html` to my configured CloudBase environment and give me its URL and verification result.

## Tools

| Tool | Purpose |
| --- | --- |
| `hosting_status` | Check credentials and static hosting; report whether local registration is enabled. Uploads and deletions remain untested. |
| `publish_html` | Publish a local HTML file or update an online page. |
| `get_html` | Query by site ID, URL or registered local path, including cloud content and public verification. |
| `list_html` | List locally known sites and their last confirmed state. |
| `offline_html` | Delete the site's current cloud HTML and legacy snapshots, keeping local registration. |
| `online_html` | Restore a registered offline site from a file you explicitly choose. |

To update or take a page offline, query it first and pass the returned hash to protect against conflicting changes. Updates and restoration keep the original URL while its domain mapping stays unchanged. See [usage examples](docs/getting-started.md#6-first-use) and [tool contracts (中文)](docs/architecture.md#3-工具契约); MCP clients also receive parameter descriptions through tool discovery.

## Before you publish

- **One HTML file:** an absolute `.html`/`.htm` path, nonempty UTF-8, at most 5 MiB. Associated local assets are not uploaded; inline them or use reachable URLs.
- **Local files remain the source:** the MCP does not back up HTML or create new project snapshots in COS. Listing, offline and restore require the local registry; it is not synchronized across machines.
- **Offline deletes cloud content:** keep your local file for restoration. Native COS Bucket versioning is separate; enabled, suspended or unconfirmed versioning blocks destructive cleanup. Existing project snapshots are not removed by ordinary updates.
- **Upload and public access are separate:** `PUBLISHED` means public HTML verification passed; `PUBLISHED_PREVIEW` means matching content with a default-domain preview restriction, such as an attachment header; `UPLOADED_NOT_PUBLICLY_VERIFIED` means storage succeeded but public access remains unverified. Default domains may show a notice or trigger a download. See [result handling](docs/getting-started.md#update-an-existing-page).

## Documentation

- [Getting started](docs/getting-started.md): shared guide for people and agents, setup, first use and troubleshooting.
- [Architecture and tool contracts (中文)](docs/architecture.md): components, parameters, storage, lifecycle sequences and test coverage.
- [Upgrading from v0.2 and legacy cleanup](docs/getting-started.md#existing-v02-installations).
- [Project scope and next steps (中文)](PROJECT.md).

## Development

```sh
npm run check
npm test
```

Tests are offline by default, including real STDIO subprocess tests using the official MCP SDK with cloud test doubles. Live cloud/browser verification is separate; see [verification scope (中文)](PROJECT.md#v03-当前实现).

## License

[MIT](LICENSE). Third-party dependencies retain their own licenses. This is an independent project, not an official Tencent Cloud product.
