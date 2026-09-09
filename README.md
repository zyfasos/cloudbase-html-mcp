# CloudBase HTML MCP

English | [简体中文](README.zh-CN.md)

Publish a local HTML file to your own CloudBase hosting environment through a small STDIO MCP server.

For people who regularly generate single-page HTML with AI: provide a local file path, get a shareable URL, and use the same page ID for later updates.

Current version: **0.3.0, a local tool**. It exposes six tools and does not depend on the full CloudBase plugin or CLI. It does not provide real-time collaborative editing, comments, databases, login pages, or application builds.

## Getting started

You need Node.js 22+, a local STDIO MCP client, and an existing CloudBase environment with static hosting enabled and an environment management API Key. Follow [Getting started](docs/getting-started.md) to install, configure, verify the connection and publish your first page. People and agents use the same guide.

New to CloudBase? Start with [account, environment, static hosting and API Key preparation](docs/getting-started.md#new-to-cloudbase). The guide explains console steps, the correct Key type and checks before starting the MCP.

Recipients of an administrator-issued API Key do not need a CloudBase login. After installing dependencies, run the local wizard in your own terminal; prefill the connection fields and enter the Key at its hidden prompt:

```sh
npm run setup -- --env-id YOUR_ENV_ID --region YOUR_REGION
```

Use `npm run setup` to enter all fields, or `--connection /absolute/private/connection.json` to import only `envId` and `region`. After a successful read-only check, it saves a private outside-Git file and prints secret-free JSON/TOML entries to merge into your client and reload. Existing files default to reuse; choose `edit` to change them. Cancellation or failed checks preserve the original. See the [local wizard guide](docs/getting-started.md#2-run-the-local-setup-wizard-recommended).

Configuration paths resolve directory symlinks before parent segments; checks, reads and saves use the same physical target. Git locations are rejected, and a missing directory followed by `..` is never silently redirected to another file.

To have your local coding agent complete setup, copy this request:

> Read docs/getting-started.md in this repository and install and register cloudbase_html in my MCP client. Reuse existing setup, have me enter the Key in the local terminal wizard, ask together for missing non-secret connection information, and verify the connection without publishing a page.

The guide also includes a URL-based request for use after source publication. This project is installed from source; it is not an npm-published package.

For implementation details, see the [architecture guide (中文)](docs/architecture.md): component boundaries, data models, and publish/update/recovery sequence diagrams.

## Tools

| Tool | Input | Result |
| --- | --- | --- |
| `hosting_status` | None | Read-only configuration, hosting and local management diagnostics; write/delete permissions remain untested |
| `publish_html` | `localPath`; update with `siteId` or `siteUrl` and `expectedSha256`; `newPage` explicitly creates another page | Write current HTML; no new cloud snapshots |
| `get_html` | Exactly one of `siteId`, `siteUrl`, `localPath` | Actual cloud hash/access verification, known lifecycle and pending operation |
| `list_html` | Optional `lifecycle`, `offset` (0), `limit` (50, maximum 100) | Current environment's locally known sites; no live cloud verification |
| `offline_html` | One selector plus query's `expectedSha256` | Delete current cloud HTML and strict legacy snapshots; retain local registration |
| `online_html` | `siteId` or `siteUrl`, plus user-designated `localPath` | Restore a locally registered offline site at its original path |

The file must be an absolute `.html`/`.htm` path, nonempty valid UTF-8, at most 5 MiB, containing an HTML tag; validation is not a full parser. Only its original bytes are uploaded, without associated assets.

To update, query first, then use the same ID or URL and returned cloud hash. The fixed object remains `sites/<siteId>/index.html`; unchanged domain mapping means unchanged URL. v0.3 no longer writes `deployments/` snapshots or returns a new `versionKey`. Ordinary updates do not remove old snapshots.

Already bound paths require explicit targeting: omitting the ID returns `LOCAL_SITE_EXISTS`, or `PAGE_OFFLINE` for an offline page. `newPage: true` cannot accompany an ID/URL; after verification it switches the path binding and retains the former site in the catalogue. An unrelated existing binding returns `LOCAL_BINDING_CONFLICT`.

URL selectors accept HTTPS `/sites/<siteId>/` or its `index.html`, with optional fragment. Query strings, credentials, traversal and other paths are rejected. Complete route discovery must confirm both the supplied path and the canonical `index.html` path map to the current environment's hosting resource; a directory URL cannot borrow a different file route. Arbitrary URL fetching does not establish ownership. Confirmed unregistered online sites can be queried and are registered on explicit update/offline.

## Lifecycle

`online` means current cloud HTML exists, independently of public verification. `offline` means deletion of the current object was confirmed. Unverified legacy records have `lifecycle: null`. A pending operation and cleanup completion are separate facts.

For offline, first query the hash, then explicitly invoke `offline_html`. It checks Bucket versioning, reserves the operation, verifies the hash, deletes current HTML, and cleans only `deployments/<siteId>/<64-lowercase-hex>/index.html` snapshots. Other sites and nonmatching files are preserved. Lists are paginated, deletes use batches up to 1000, and a run allows up to 100 list pages; incomplete deletion can be retried. A partially successful batch never counts as complete.

If current deletion succeeds but cleanup fails, the result reports offline with `cleanup.complete: false`. Retry with the original operation's expected hash. A timeout can mean deletion already happened; query before retrying. Deletion does not purge copies already held in external caches.

`online_html` requires local offline registration, a user-designated file, and no current cloud object. Missing local files block upload; unexpected cloud recreation is a conflict. An earlier restore that wrote matching content but timed out can be verified without uploading again. Complete pending cleanup before restoration. Already online sites use `publish_html`, not `online_html`.

Native COS Bucket versioning is separate from application snapshots. Enabled, suspended or unconfirmed versioning blocks destructive cleanup. This MCP never changes Bucket settings; stopping application snapshots does not disable native versions.

## Domain selection and page registration

When `CLOUDBASE_PUBLIC_BASE_URL` is unset, the tool reads gateway domain routes in the current environment. It prefers enabled custom domains that point to the current static hosting resource, then considers platform default domains. It uses the longest matching path prefix for the specific page and excludes disabled routes, authentication requirements, other upstream resources, and domains that are not ready. Non-root routes must explicitly enable path transmission. Path rewrites and wildcard paths are not automatically interpreted; routes that cannot be confirmed are excluded with a reason.

An explicitly configured `CLOUDBASE_PUBLIC_BASE_URL` takes precedence and is not automatically replaced. If its route is known to be disabled or point to another resource, it is not treated as a valid candidate. If route lookup fails or exceeds the three-page limit, `access.discovery` reports the condition, and the native static hosting domain may be tried; route validity remains unknown in that case. At most three public URL candidates are checked, each requiring matching content type and hash. Results include `urlSource`, candidates, exclusion reasons, and actual checks. `hosting_status` does not verify public page content.

The object path stays fixed for a given siteId. The domain in the returned URL may change when configuration changes or a candidate becomes unavailable. An existing URL continues to address the same page as long as its domain still routes correctly. The tool does not create domains, modify routes, or switch environments.

The registry stays outside Git, defaulting to `.config/cloudbase-html-mcp/pages/` under your home directory. `CLOUDBASE_REGISTRY_DIR` can name another absolute outside-Git directory or `off`. Disabling it keeps basic publish/ID query, but disables list/offline/online.

v2 stores one atomic JSON catalogue per environment/region, keyed by siteId, with paths, URL, last hash, lifecycle, verification time and unfinished operations. It stores no HTML or credentials. Files use 0600, new directories 0700. An exclusive environment lock covers writes across different paths; separate machines or registry directories are not coordinated.

`localPaths` contains only current selectors derived from the authoritative path bindings. `sourcePaths` preserves historical source locations; it is not a set of current selectors or HTML backups. After `newPage`, a former site's path moves out of `localPaths` but remains in its source history. Older v2 records are normalized on read without rewriting disk; the next locked write persists the corrected view.

If catalogue metadata is corrupt or unreadable, `get_html` can still query a known ID or route-confirmed URL and returns `registryDiagnostic: { state: "UNAVAILABLE", code: ... }`. It does not repair the file or infer an offline lifecycle from missing metadata. Path-based queries, lists and all writes remain blocked until the catalogue is repaired.

v1 files remain readable and are migrated under the first write lock. Originals remain on disk but stop being authoritative after migration. Active/pending IDs are preserved; paths for the same ID are merged, conflicting old hashes become unknown until verified. Failed new-page operations retain the original binding. Cloud success with failed local finalization returns `registry.state: UPDATE_FAILED`; query and retry the original operation. Corruption blocks writes. Stale locks require confirmation that no writer remains before manual removal. Do not downgrade to a v0.2 writer after migration.

## Interpreting publish results

- `PUBLISHED`: the public response is HTML, its SHA-256 matches, and it does not force a download.
- `PUBLISHED_PREVIEW`: content verification passed, but the CloudBase default domain requires visitors to go through the platform's access notice.
- `UPLOADED_NOT_PUBLICLY_VERIFIED`: cloud storage verification passed, but public verification has not. Query again; do not report the shareable URL as verified.
- `isError=true`: the operation failed. Results include the stage and error code; once writes begin, they also include the page ID, write state to identify partial success.

Failures also include `next_step`, `retryable`, and `maxRetries`. Executable suggestions use existing tool names and `suggested_args`. Configuration corrections use `required_config`, keeping credentials out of tool arguments. Query with `get_html` before handling a content conflict or an uncertain write. If public verification fails, the tool suggests one later query. It does not retry indefinitely or automatically repair permissions.

CloudBase default domains are intended for development and testing and may display an intermediate page or return an attachment header. See the [official documentation](https://docs.cloudbase.net/service/alias). For direct public sharing, configure an HTTPS custom domain already bound to the current environment. This tool will not create domains or modify routes for you.

## Storage and cleanup

Environment API Key → temporary credentials → hosting/routes → current object PUT → HEAD → public GET. There is no rollback, cloud backup, full-stack build or cross-machine transaction.

Upgrade and publication do not delete old snapshots. The cleanup script defaults to a read-only manifest: explicitly name the environment and site IDs, save JSON outside Git, and inspect keys/count/bytes. Execution requires `--apply` plus an absolute manifest path. It checks environment, Bucket, paths and current ETags/sizes; only manifest objects are deleted. Current HTML and snapshots added later are preserved. Native versioning must be confirmed off. The script shares the local environment lock.

```sh
node --env-file=/absolute/private/cloudbase-html.env scripts/cleanup-snapshots.mjs --env-id YOUR_ENV_ID --site-id s_REPLACE_WITH_VALID_ID
node --env-file=/absolute/private/cloudbase-html.env scripts/cleanup-snapshots.mjs --env-id YOUR_ENV_ID --site-id s_REPLACE_WITH_VALID_ID --apply --manifest /absolute/private/cleanup-manifest.json
```

Replace the ID with `s-` plus 32 lowercase hex digits; repeat `--site-id` for multiple sites. Run the second command only after explicit approval of the saved manifest. No automatic migration cleanup is performed.

## Development

```sh
npm run check
npm test
node scripts/call.mjs --config /absolute/private/cloudbase-html.env hosting_status
node scripts/call.mjs --config /absolute/private/cloudbase-html.env publish_html '{"localPath":"/absolute/path/page.html"}'
```

`npm test` runs only `test/*.test.mjs`; it does not automatically start the test subprocess entry point. Tests do not access cloud resources by default. `scripts/call.mjs` is a one-shot protocol client built with the official MCP SDK.

| Test file | Behavior covered |
| --- | --- |
| `test/config-paths.test.mjs` | Physical symlink/parent paths, Git and directory protections, consistent save targets, launcher rejection and ordinary alias compatibility |
| `test/setup.test.mjs` | Hidden input, prefills, reuse/edit, failure preservation, private persistence, generated configuration and real STDIO connection with cloud doubles |
| `test/publisher.test.mjs` | Input rejection, credential refresh, publish/update conflicts, partial failures, public verification, in-process exclusion, and the production STDIO entry point's cold start |
| `test/domains.test.mjs` | Domain priority, path coverage, disabled/wrong upstream routes, pagination, permission denial, candidate limits, and public fallback |
| `test/registry.test.mjs` | Registration with real temporary files, environment isolation, reads across instances, corruption, write failures, locks, duplicate creation, and binding conflicts |
| `test/recovery.test.mjs` | Next steps for configuration, authentication, and conflicts; querying after partial writes; bounded retry suggestions |
| `test/lifecycle.test.mjs` | URL validation, catalogue migration, offline/restore, cleanup and COS adapter contracts |
| `test/review-fixes.test.mjs` | Active versus historical paths, directory/file route separation, and read-only cloud queries with unavailable metadata |
| `test/stdio.test.mjs` | Publishing, recovering the ID after restart, updating, and partial-failure recovery through real subprocess STDIO using the official SDK; cloud behavior is supplied by an independent offline test double |

v0.3 has offline tests and real STDIO subprocess tests with cloud doubles. On 2026-09-09, an authorized synthetic page also passed live API Key connection, ID/path/URL queries, stable-URL update, stale-hash rejection, offline deletion (public HTTP 404), catalogue reads after restart, and restoration to the original URL. A scoped object listing found one current HTML and no project snapshots. Programmatic requests matched the HTML but carried an attachment header, and browser automation did not complete navigation. A subsequent user-supplied Chrome screenshot confirmed the original URL rendering the restored v2 page. This confirms that browser session, not first-visit behavior across all clients; a fresh GitHub installation remains unverified. Real deletion of pre-existing snapshots and failure/recovery variants were not exercised in this live run. See [PROJECT.md](PROJECT.md).

This is an independent tool, not an official Tencent Cloud product. It uses the official MCP, Tencent Cloud TCB, and COS SDKs rather than implementing the MCP protocol or cloud API signing itself.

## License

This project is licensed under the [MIT License](LICENSE). Third-party dependencies retain their own licenses. This repository does not bundle dependency source code or business HTML files.
