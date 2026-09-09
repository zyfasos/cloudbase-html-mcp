# Getting started

## 1. What you will have

Connect **CloudBase HTML MCP** to your local MCP client so you can publish a designated HTML file to your own CloudBase environment and update the same page later. This guide works for people following the steps and for a coding agent carrying out setup on their behalf.

Setup is complete when your client exposes `hosting_status`, `publish_html`, `get_html`, `list_html`, `offline_html`, and `online_html`, and its `hosting_status` call succeeds. Setup uses read-only cloud checks; publishing your first page is a separate action in [First use](#6-first-use).

This project is installed from source. It requires neither the full CloudBase plugin nor CloudBase CLI, and it does not provide an npm package or hosted HTTP MCP endpoint. For component boundaries and implementation details, see the [architecture guide (中文)](architecture.md).

## 2. Before you begin

| Requirement | What to prepare or check |
| --- | --- |
| MCP client | A client that can run local STDIO servers. Configuration examples below cover Codex and clients using `mcpServers` JSON. |
| Node.js 22+ | Run `node --version`; obtain the absolute executable path with `node -p 'process.execPath'`. |
| Source directory | Reuse your existing checkout, or choose a stable user-owned directory for a new clone. |
| CloudBase environment | Environment ID, region and server-side environment API Key, or a designated private file containing them. An administrator can provide these; recipients do not need a CloudBase login. Environment owners starting from scratch can follow [New to CloudBase](#new-to-cloudbase) below. |

For agent-assisted setup, reuse information already supplied and the existing `cloudbase_html` client entry. Collect missing client or environment information together; do not scan unrelated credential files. Local installation and tool-list checks can proceed while credentials are pending.

### New to CloudBase

Received an API Key from an administrator? Obtain the matching environment ID and region from them, then skip the console steps and use the [local setup wizard](#42-run-the-local-setup-wizard-recommended).

Already have an environment and a private configuration file? Reuse them and continue with [agent-assisted setup](#3-let-your-agent-set-it-up) or [manual installation](#4-install-and-configure). Otherwise, prepare the following in order. Console labels may change; the linked official guides are the reference.

| Step | Where to go and what to do | Ready when |
| --- | --- | --- |
| 1. Sign in | Open the [CloudBase console](https://tcb.cloud.tencent.com/dev). Register/sign in to your Tencent Cloud account and complete required identity verification. | You can access the console with the account that will own the environment. |
| 2. Prepare an environment | Follow [Create an environment](https://docs.cloudbase.net/quick-start/create-env). Reuse a suitable existing environment; otherwise review service terms, service-role authorization, region and plan before creating one. | Initialization has finished and the intended environment is selected. |
| 3. Record its identity | In the selected environment's information/settings, copy **环境 ID / EnvId** and its **地域 / region code**. Use the ID, not the display name; use the actual region code, not a default copied from an example. | You have matching `CLOUDBASE_ENV_ID` and `CLOUDBASE_REGION` values for the same environment. |
| 4. Check static hosting | Open **静态网站托管** in that environment. Follow any activation prompt after reviewing its terms. Use the **文件管理** workflow for existing HTML, as described in the [official hosting guide](https://docs.cloudbase.net/hosting/quick-start). | The selected environment's static hosting file-management page is available; the MCP will check its online state later. |
| 5. Obtain the Key | In the same environment, open **环境设置 / API Key 管理（API Key 配置）**. Reuse a valid server-side Key you already hold, or create a server-side **API Key (`api_key`)** with a recognizable name and a suitable expiry. Enter the complete value in the local wizard’s hidden prompt, or save it directly into the private file described below. | You have the full Key value, not its name, ID or masked list value. |

The environment owner completes login, identity verification, service-role authorization, resource activation, plan/payment confirmation and Key creation in the console. An installing agent can explain the steps and continue local checks while waiting. It must not submit an order, activate resources or create credentials merely because setup was requested. Prices, trial eligibility and quotas depend on the current account and plan; review the console rather than assuming the MIT-licensed tool makes CloudBase usage free.

CloudBase's [API Key reference](https://docs.cloudbase.net/api-reference/manager/node/login-config#createapikey) distinguishes server administrator `api_key` from frontend anonymous `publish_key`; the full server Key is returned only when created. If you only have a masked value and no saved copy, ask the owner to create a replacement; do not delete an existing Key used elsewhere. The [official MCP authentication documentation](https://docs.cloudbase.net/ai/cloudbase-ai-toolkit/connection-modes) describes the environment-level Key used to exchange temporary credentials.

**Use the correct credential:** this MCP takes the server-side environment API Key in `CLOUDBASE_API_KEY`. A Publishable Key, a Key ID, a Tencent Cloud CAM SecretId/SecretKey pair, or a CloudBase CLI login session cannot substitute for it in this implementation. The Key has environment administrator access, beyond the six tools exposed here; keep it in the private file, not a frontend page or repository.

You can enter the Key in the private file yourself and give the agent only the file path. The agent needs the target environment/region or that designated file, not your console password. If a console entry is unavailable, have the environment owner check access; do not choose another environment to bypass it.

**No custom domain is required for the connection check.** Leave `CLOUDBASE_PUBLIC_BASE_URL` unset initially. Default-domain preview restrictions and unverified public access are explained in [First use](#6-first-use); binding a custom domain is a separate configuration decision. Do not upload a console sample just to finish setup.

## 3. Let your agent set it up

From a local checkout, copy this request to your coding agent:

> Read docs/getting-started.md in this repository and install and register cloudbase_html in my MCP client. Reuse my existing installation and private environment file if available. Complete the local and read-only connection checks. If an administrator supplied my Key, reuse their environment ID and region without requiring console login. Have me run npm run setup in my own terminal for hidden Key entry; do not ask for the Key in chat. Ask together for missing client or non-secret connection information. Do not publish a page during setup.

中文指令：

> 阅读本仓库的 docs/getting-started.md，帮我安装并注册 cloudbase_html MCP。优先复用已有安装和仓库外的私人环境文件，完成本地检查和只读连通验证；如果管理员已提供 Key，复用其环境与地域，无需控制台登录；让我在本机终端运行 npm run setup 隐藏输入 Key，不在聊天中收集 Key；缺少客户端或连接信息时集中问我。接入时不要发布页面。

After the source has been pushed to GitHub, you can share this request without supplying a local checkout:

```text
Read https://raw.githubusercontent.com/zyfasos/cloudbase-html-mcp/main/docs/getting-started.md
and install and register cloudbase_html in my MCP client. Reuse existing setup,
reuse administrator-provided connection information when available, guide me to
run npm run setup in my terminal for hidden Key input, and verify without publishing.
```

An empty repository or HTTP 404 means the source is unavailable at that address. Use a supplied local checkout or report the missing source; do not scaffold a replacement.

The agent follows the same installation and verification steps below, under the user's request and the host's permissions. Setup does not authorize page publication or changes to cloud resources, domains, permissions or Git remotes. If you are installing manually, continue with the next section.

## 4. Install and configure

The shell examples use POSIX syntax. On Windows, adapt shell quoting while keeping the same absolute executable and argument values in the client configuration.

Set these variables first, replacing the two placeholder paths with your chosen locations. Keep the environment file outside any Git repository:

```sh
CLOUDBASE_HTML_REPO="/absolute/path/to/cloudbase-html-mcp"
CLOUDBASE_HTML_NODE="$(node -p 'process.execPath')"
CLOUDBASE_HTML_ENV_FILE="/absolute/private/cloudbase-html.env"
```

A suggested private file location is `.config/cloudbase-html-mcp/credentials.env` under your home directory. These variables are used by the shell examples; replace paths in the TOML or JSON templates with literal absolute paths.

### 4.1 Install and check locally

For a new installation, after the source is available on GitHub:

```sh
git clone https://github.com/zyfasos/cloudbase-html-mcp.git "$CLOUDBASE_HTML_REPO"
```

If the directory already exists, inspect its identity and reuse it; do not clone over it, reset changes, or automatically pull. Confirm it contains `package.json`, `package-lock.json`, and `src/server.mjs`. For a fresh checkout:

```sh
cd "$CLOUDBASE_HTML_REPO"
npm ci --ignore-scripts
npm run check
npm test
"$CLOUDBASE_HTML_NODE" "$CLOUDBASE_HTML_REPO/scripts/call.mjs" list
```

On repeat setup, reuse an installed dependency tree when it matches the lockfile; do not reinstall or upgrade dependencies just to repeat setup. Report relevant audit warnings separately from test results. The final command uses a real STDIO client and needs no CloudBase credentials. It must list exactly `hosting_status`, `publish_html`, `get_html`, `list_html`, `offline_html`, and `online_html`.

### 4.2 Run the local setup wizard (recommended)

After installing dependencies, run this **yourself in a local interactive terminal**, from the checkout:

```sh
npm run setup
```

It asks for environment ID, region, and a hidden API Key, displays the selected environment and destination, then asks to proceed with a read-only connection check. It uses the existing credential exchange and static-hosting check; no account login, HTML upload, deletion, or hosting activation occurs. No Key is accepted in command arguments or piped stdin. An agent can prepare the command and finish client registration, while you enter the Key directly in your terminal.

Administrators can prefill the two connection fields so recipients only enter the Key and confirm:

```sh
npm run setup -- --env-id YOUR_ENV_ID --region YOUR_REGION
```

Alternatively provide a private connection JSON file containing **only** the connection fields (no Key):

```json
{ "envId": "your-env-id", "region": "ap-shanghai" }
```

```sh
npm run setup -- --connection /absolute/private/connection.json
```

Use the real region supplied by the administrator. Conflicting file and command-line values are rejected. This connection file is separate from the credential file; keep real environment information outside this repository.

The default credential file is `~/.config/cloudbase-html-mcp/credentials.env`. To reuse a designated location, including the variable used in this guide:

```sh
npm run setup -- --config "$CLOUDBASE_HTML_ENV_FILE"
```

`--config` can be combined with either prefill method. Existing files default to **reuse** without rewriting or asking for the Key. Choose `edit` to complete a partial file or change settings; blank Key input retains the existing Key. Existing optional CloudBase fields are preserved. A conflicting prefilled environment is rejected during reuse; choose edit explicitly or a different credential file. Failed connection checks and cancellation leave existing credentials unchanged, and do not save new credentials. Re-run the command after correcting the issue.

The wizard creates a private directory (0700) and atomically saves a file (0600) on macOS/Linux. Existing directories/files must already be private and owned by you; it reports a permission error instead of changing existing permissions. It rejects Git locations, credential-file symlinks, unrelated dotenv variables, and concurrent/conflicting saves. Directory symlinks are resolved before parent segments so checks, reads, saves and generated startup paths share one physical target. An unresolved missing directory followed by `..`, or a directory-only destination, is rejected instead of selecting a different file. After a process exits during saving, confirm no writer remains before removing a stale `<credentials.env>.lock`. Windows users must manage their account’s filesystem ACLs; POSIX modes are not an ACL guarantee.

Successful output includes **copyable JSON and Codex TOML entries with absolute paths, without the Key**. The generated entry runs `scripts/start.mjs`, which loads the selected file and replaces inherited CloudBase settings, including clearing absent optional settings. It does not modify the client configuration automatically. Merge the appropriate entry, preserving other servers, and reload your client as described in [Register the server](#44-register-the-server-in-your-client). If you used the default location, set `CLOUDBASE_HTML_ENV_FILE` to the path shown by the wizard before using later shell examples. You can skip the manual file-creation alternative below.

The check confirms credentials and online static hosting. Domain discovery is reported separately; upload permission, public page access, and activation in your actual MCP client remain unverified until their respective checks. `npm run setup -- --help` shows all options.

### 4.3 Alternative: prepare the private environment file manually

Create the parent directory and an empty private file if it does not exist. This POSIX snippet preserves existing files and refuses to overwrite a file created concurrently:

```sh
(
  umask 077
  mkdir -p "$(dirname "$CLOUDBASE_HTML_ENV_FILE")" &&
  if [ ! -e "$CLOUDBASE_HTML_ENV_FILE" ]; then
    set -C
    printf '%s\n' '# CloudBase configuration pending' > "$CLOUDBASE_HTML_ENV_FILE"
  fi
)
```

An empty file lets the MCP start and report `CONFIG_REQUIRED` while you finish the console steps. It does not establish a cloud connection. Leave missing values absent instead of writing placeholder credentials into the real file.

Use [.env.example](../.env.example) as the field reference. Reuse your existing private file, or create a new file in a text editor with the values for your environment. An installing agent should use file tools and only user-supplied values. On macOS/Linux use a private directory and file mode 0600. Do not print the API Key or place it in shell command arguments, client configuration, the checkout, or a published HTML file.

```dotenv
CLOUDBASE_ENV_ID=your-env-id
CLOUDBASE_REGION=your-region
CLOUDBASE_API_KEY=your-environment-management-api-key
```

Leave `CLOUDBASE_PUBLIC_BASE_URL` unset to discover domains. Only set it when the user has an HTTPS domain already bound to the target environment. The page registry defaults to `.config/cloudbase-html-mcp/pages/` under the user's home directory; it also stays outside Git. Do not disable it during ordinary setup.

This server uses the environment API Key to obtain temporary cloud credentials. An interactive CloudBase CLI login is not required. The placeholder values above must be replaced before the cloud connection check. Use a dedicated directory you own. After saving the file, restrict that directory and file on macOS/Linux:

```sh
chmod 700 "$(dirname "$CLOUDBASE_HTML_ENV_FILE")"
chmod 600 "$CLOUDBASE_HTML_ENV_FILE"
```

### 4.4 Register the server in your client

Before registering, confirm the environment file exists and is readable:

```sh
test -f "$CLOUDBASE_HTML_ENV_FILE" && test -r "$CLOUDBASE_HTML_ENV_FILE"
```

Continue only if this check exits successfully. If it fails, return to the private-file step. The launcher exits before MCP starts when the path is missing or its file protections fail, so the server cannot deliver tool-level setup guidance in that case. Keep the explicit file requirement so a misspelled path is not silently ignored.

Use the host's MCP management capability when available. Otherwise merge only this server entry into the client's existing configuration, preserving all other settings. If an identical `cloudbase_html` entry already exists, reuse it. Resolve an existing conflicting entry from the user's stated target instead of adding duplicates.

**Codex:** merge the following table into its user configuration (`~/.codex/config.toml` by default; respect a configured Codex home). Replace all three paths with actual absolute paths; serialize them correctly, including spaces and Windows backslashes. The command is Node itself; the launcher reads the explicitly selected private file, overriding inherited CloudBase settings. Existing installations using Node’s native `--env-file` remain supported, but environment variables inherited by Node take precedence in that legacy mode. These fields are documented in the [official Codex MCP configuration guide](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

```toml
[mcp_servers.cloudbase_html]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/cloudbase-html-mcp/scripts/start.mjs", "/absolute/private/cloudbase-html.env"]
startup_timeout_sec = 15
tool_timeout_sec = 180
enabled_tools = ["hosting_status", "publish_html", "get_html", "list_html", "offline_html", "online_html"]
```

**Other local MCP clients:** map the same command and arguments to the client's STDIO settings. For clients using an `mcpServers` JSON configuration, the entry is:

```json
{
  "mcpServers": {
    "cloudbase_html": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/cloudbase-html-mcp/scripts/start.mjs",
        "/absolute/private/cloudbase-html.env"
      ]
    }
  }
}
```

The JSON file location and optional timeout/tool-policy settings are client-specific. Use at least 180 seconds for tool calls where supported. Do not invent client settings or replace a whole configuration file with this example. Keep the client's normal write-approval policy for publish, offline and online operations.

## 5. Verify the connection

Reload the server using the client's supported mechanism. If your client requires a restart, restart it before checking tools there. An installing agent that cannot restart the client should report activation as pending and continue the standalone check below.

Once the private file contains the actual environment ID, region and Key, run the read-only connection check:

```sh
"$CLOUDBASE_HTML_NODE" "$CLOUDBASE_HTML_REPO/scripts/call.mjs" --config "$CLOUDBASE_HTML_ENV_FILE" hosting_status
```

If the result is `CONFIG_REQUIRED`, follow `next_step.required_config` and `next_step.setup_guide`; the local guide works before the repository is published. A credential error requires checking the selected environment, region, Key type/full value and expiry, then reloading the MCP after editing its file. `STATIC_STORE` failures require checking the selected hosting resource; an incomplete response is not proof that you must create one.

Then list tools from the actual host client and call `hosting_status` there as well, when the client is loaded. The script proves the standalone server works; it does not by itself prove the host loaded its new configuration.

| Milestone | Required evidence |
| --- | --- |
| Local server ready | Checks/tests passed and the standalone client listed exactly six tools. |
| Client connected | The actual MCP client exposes those tools and its `hosting_status` call returns `ok: true`. |
| Cloud connection verified | `hosting_status` validated credential exchange and static hosting; `uploadPermission` and `publicVerification` remain `NOT_TESTED`. |

Setup is complete when the actual client exposes all six tools and its `hosting_status` call returns `ok: true`. This validates credential exchange and hosting access; upload permission and public page access remain untested.

An installing agent should report the installation directory, private file location without its contents, configured client, checks performed, and any pending input or restart. A successful standalone check alone is not a completed client connection.

## 6. First use

### Publish a page

Replace the example path with your own file and ask your agent:

> Publish `/absolute/path/report.html` to my configured CloudBase environment and give me the URL.

On that separate publishing request, use `publish_html` with the **user-designated** file. Files must be UTF-8 HTML and at most 5 MiB; associated local assets are not uploaded. Do not upload a sample or business file merely to test setup.

A successful result includes the `siteId`, content hash, URL and verification status. Keep the ID if you plan to access the page from another machine.

### Update an existing page

For repeated edits to the same URL, keep using the same `siteId`. `publish_html` overwrites `sites/<siteId>/index.html` without creating cloud snapshots; the URL stays the same while its domain mapping stays unchanged. You do not need a separate overwrite tool. `newPage: true` creates a different page and is not an update.


> Update the page previously published from `/absolute/path/report.html`.

For updates, first call `get_html({"localPath":"/absolute/path/report.html"})`. Use its returned `siteId` and current `sha256` as `expectedSha256` in `publish_html`, keeping the user's file path. If there is no registration, ask for the known page ID or establish that the user wants a new page; do not silently treat an update request as a new publication. `newPage: true` is for an explicit request to create another page.

The agent's update sequence is:

1. Call `get_html` with the registered `localPath`, or the known `siteId` if the file was moved or you are using a different machine.
2. Call `publish_html` with the new content's `localPath`, the same `siteId`, and the query result's `sha256` as `expectedSha256`.
3. Check the publish result. If there is a version conflict, query again and review the target before proceeding.

If you only have a URL, call `get_html({"siteUrl":"https://your-domain.example/sites/s_REPLACE_WITH_VALID_ID/"})`, replacing the domain and ID with the actual published URL. Then update with `siteUrl`, `localPath` and the returned hash. Only HTTPS canonical site paths are accepted, with optional fragment and no query string; both the supplied path and its canonical `index.html` path must route to this environment's hosting resource. Incomplete route discovery is rejected. A conflicting local path binding still requires resolving the intended target.

Interpret the returned status before sharing the URL:

| Status | Meaning |
| --- | --- |
| `PUBLISHED` | Public HTML content matches the uploaded file and does not force a download. |
| `PUBLISHED_PREVIEW` | Content matches, but the default-domain response indicates a preview restriction; visitors may encounter a platform access notice. |
| `UPLOADED_NOT_PUBLICLY_VERIFIED` | Storage checks passed; public access has not been verified. |

Follow `next_step` on failure. See [README](../README.md) for pending registrations, conflicts, and domain behavior.

### List, take offline, and restore

List the current environment's locally known pages with `list_html({"limit":50})`. Use `lifecycle: "online"` or `"offline"` to filter and `nextOffset` to continue. This list reports last confirmed local state; use `get_html` for fresh cloud facts. Old migrated records may have `lifecycle: null` until verified through a write operation.

Use the site's `siteId` or verified URL to manage a listed site. `localPaths` lists its currently bound path selectors. `sourcePaths` is historical source information and must not be used as a current binding: after `newPage`, that file may belong to another site.

> Take the page at my published URL offline and delete its cloud HTML and old snapshots. Keep the local file and registration.

The agent first calls `get_html`, then `offline_html` with one of `siteId`, `siteUrl` or registered `localPath` and the query's `sha256` as `expectedSha256`. This is destructive cloud deletion. It checks Bucket versioning before deleting. If current HTML was removed but snapshots remain, report `cleanup.complete: false` and resume the original operation; do not claim all storage was reclaimed. Deletion does not purge external cached copies.

> Restore that offline page using `/absolute/path/report.html`, keeping its original URL.

Use `online_html` with the site's ID or verified URL plus that user-designated file. Local offline registration is required. The file must exist and the cloud current object must be absent; an unexpectedly present object is a conflict. Finish pending cleanup first. An uncertain prior restore that wrote matching bytes can be checked and finalized. An already online page must use the normal update flow.

After a cloud-success/local-finalization warning, inspect the object and retry the same operation rather than creating a new ID. All management requires the local registry; `off` disables list/offline/online. A stale environment lock after process exit needs manual removal only after confirming no writer remains.

### Existing v0.2 installations

Reload the MCP after upgrading and expose all six tools in any client allowlist. New publishes stop creating `deployments/` snapshots and no longer return a new `versionKey`. Old local records migrate under the first environment write lock, preserving active/pending IDs and source files; do not downgrade to a v0.2 writer. Back up the private registry directory before upgrading if you need a local migration backup.

Existing snapshots are not deleted automatically. See the [README cleanup procedure](../README.md#storage-and-cleanup) for a default-read-only manifest and an explicitly authorized apply step. Native COS Bucket versioning is separate: enabled, suspended or unconfirmed settings block cleanup; this MCP does not change them.

## 7. Troubleshooting

| Symptom | Next action |
| --- | --- |
| Missing Node or Node below 22 | Obtain a supported runtime through the user's normal setup process, then resolve its absolute path. |
| Repository empty or source download returns 404 | Use the provided local checkout or wait for source publication; do not scaffold a replacement. |
| No CloudBase environment or Key | Follow [New to CloudBase](#new-to-cloudbase); return after the owner completes console preparation. |
| Node reports the env file is missing; client cannot start the server | Check the exact absolute path and create/read-check the private file before registering. This occurs before MCP can return `CONFIG_REQUIRED`. |
| `CONFIG_REQUIRED` | Follow `next_step.required_config` and `setup_guide`; fill only the missing fields in the private file and reload the MCP. |
| `STATIC_STORE` / `NOT_ONLINE` or `INVALID_RESOURCE` | Check hosting in the selected environment; wait for initialization if applicable. Do not assume an incomplete response means no resource exists. |
| Credential exchange or access denied | Check the same environment/region, full server-side `api_key`, expiry and account access. Publishable Key and CAM credentials are not accepted substitutes. Reload after editing the file; do not switch environments or repair permissions automatically. |
| Standalone check works, client tools missing | Read back only the relevant client entry; check executable/argument paths and server reload. |
| `REGISTRY_INSIDE_REPOSITORY` or registry permission error | Put `CLOUDBASE_REGISTRY_DIR` in a private, writable directory outside Git, then reload the server. |
| `REGISTRY_BUSY` | Another write in the same environment holds the lock. Wait; if its process exited, verify no writer remains before removing that environment lock. |
| `PAGE_OFFLINE` / `PAGE_NOT_OFFLINE` | Use explicit online restoration for an offline page; use publish/update for an online page. |
| `CLEANUP_PENDING` | Inspect the pending offline operation and retry with its original expected hash before restoring. |
| `VERSIONING_UNSAFE` / `VERSIONING_UNCONFIRMED` | Cleanup cannot establish physical removal. Ask the environment owner to review Bucket versioning; do not change it automatically. |
| `SITE_URL_UNCONFIRMED` | Check the selected environment and its domain route. Use a known site ID only after confirming the intended target, not to bypass an unexplained mismatch. |
| `registryDiagnostic.state: UNAVAILABLE` on a query | Cloud results are available, but local metadata is not. Preserve the catalogue and inspect the diagnostic; known-ID or validated-URL queries remain read-only. Path queries, lists and writes still require a healthy catalogue. |
