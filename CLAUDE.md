# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`@drumee/setup-schemas` is a Node.js library that bootstraps a Drumee platform instance: it initializes MariaDB schemas, creates system accounts (nobody, guest, system user, admin), sets up hubs (shared spaces), and imports media content. It is consumed by `@drumee/setup`, not run standalone by end users.

## Commands

```bash
# Run the full install sequence (requires a configured Drumee environment)
node populate.js

# Publish a new patch release
npm run release   # git push + npm publish + npm version patch

# Run an individual test file
node test/db.js
node test/modules.js
```

There is no `npm test` script; tests in `test/` are run directly with `node`.

## Architecture

### Entry point
`index.js` re-exports the three public classes: `Drumate`, `Mfs`, `Organization`.

### `populate.js` — full setup sequence
The canonical run order:
1. `prepare()` — verifies DB connectivity, creates the app DB user from `/etc/drumee/credential/db.json`
2. `Cache.load()` — warms the server cache (from `@drumee/server-essentials`)
3. `org.populate()` — writes `sys_conf`, `domain`, `vhost`, `organisation`, `settings`, and mailserver rows
4. `org.createNobody()` / `org.createGuest()` — creates fixed-UID system accounts
5. `org.createSystemUser()` — creates `system@<domain>`, a public media hub, and a portal hub
6. `org.createAdmin(media)` — creates the admin account, sets quotas, generates a password-reset token and URL
7. `mfs.importContent()` / `mfs.importTutorial()` — downloads and registers wallpapers and tutorial files via `Mfs`
8. `afterInstall()` — generates RSA key pair, renders `asset/welcome.html` into `<data_dir>/tmp/welcome.html`

### `lib/organization.js` — `Organization extends Logger`
Orchestrates the full instance lifecycle. Reads live config via `getConfigs()` at module load time; does not take constructor arguments beyond the inherited `Logger` API. Key methods: `populate()`, `createNobody/Guest/SystemUser/Admin()`, `remove(domain_id)`.

### `lib/drumate.js` — `Drumate extends Common (lib/index.js)`
Manages individual user accounts. `create(opt)` calls the `drumate_create` stored procedure then `updateEntries()` to assign a deterministic UID and normalize `home_dir`. `createHub(opt)` creates a hub via `desk_create_hub`. Both guard against pre-existing records before inserting.

### `lib/mfs.js` — `Mfs extends Logger`
Handles media filesystem operations. `importContent(vhost)` fetches a remote manifest and walks the node tree; `importFile(url, dest)` downloads to a temp dir, calls `mfs_create_node`, then `cpSync`s to the storage path `<home_dir>/__storage__/<id>/orig.<ext>`. Requires `db_name` in the constructor to connect to a per-entity MariaDB database.

### `lib/schema.js` — `__schema extends Logger`
Low-level entity provisioning: `create_entity()` calls `entity_create` stored procedure, `load_sql()` pipes a SQL template into MariaDB via `shelljs.exec`, `create_vfs_root()` builds the `__storage__` directory and calls `chown`.

### `lib/utils.js`
Stateless helpers exported directly (not a class): `getConfigs()`, `makeSchemasTemplates()`, MariaDB user management (`create_user`, `reset_user`, `grant_privilege`, `ensure_app_user`), `shellExec()`, `runSql()`.

### `bin/` — CLI scripts
| Script | Purpose |
|---|---|
| `bin/acknowledge.js` | Sends the post-install welcome email via `Messenger` |
| `bin/adduser.js` | Stub for adding a user (in progress) |
| `bin/remove-org.js` | Removes an org by domain ID |
| `bin/args.js` | Shared `argparse` setup for bin scripts |

## Configuration

Runtime config is assembled in `lib/utils.js:getConfigs()` by merging `defaultConf` with `sysEnv()` (reads the Drumee system environment file). Key env vars:

| Variable | Purpose |
|---|---|
| `DRUMEE_DOMAIN_NAME` | Primary domain (required) |
| `ADMIN_EMAIL` | Admin account email (falls back to `admin@<domain>`) |
| `ACME_EMAIL_ACCOUNT` | ACME/Let's Encrypt email (fallback for admin) |
| `DRUMEE_DESCRIPTION` | Human-readable org name |

Credential files expected at `/etc/drumee/credential/`: `db.json`, `email.json`, `postfix.json`, `crypto/public.pem`, `crypto/private.pem`.

## Key conventions

- All DB access goes through `Mariadb` from `@drumee/server-essentials` using `await_query` / `await_proc` / `await_func`.
- `uniqueId()` (from `@drumee/server-essentials`) is used for all generated IDs — never `uuid` or `Math.random()`.
- Classes extend `Logger` (also from `@drumee/server-essentials`); use `this.debug(...)` / `this.warn(...)` rather than `console.log` for non-critical output.
- `lib/mfs.js` (exported as `Mfs`) is the full implementation; `lib/index.js` (`Common`) is a minimal base used only by `Drumate`.
