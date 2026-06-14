# Drumee Schemas Setup Tools

`@drumee/setup-schemas` bootstraps a fresh **Drumee** instance's database and initial
data. After [`setup-infra`](../setup-infra) has written the configuration and
credentials, this package creates the MariaDB application user, builds the schemas, and
provisions the system accounts, hubs, and seed media that a usable instance needs.

```bash
npm i @drumee/setup-schemas
```

It is normally invoked by the Drumee install pipeline (the `drumee-schemas` Debian
package), not run by hand. For how it relates to the other repos, see
[`setup-infra/DOCUMENTATION.md`](../setup-infra/DOCUMENTATION.md).

## What it does

`populate.js` is the canonical install sequence. Run end to end it:

1. **`prepare()`** — reads `/etc/drumee/credential/db.json`, creates the `drumee-app`
   MariaDB user (and the `mailserver` user from `postfix.json` if present), then
   smoke-tests connectivity by creating and dropping a throwaway database.
2. **`Cache.load()`** — warms the server cache from `@drumee/server-essentials`.
3. **`Organization.populate()`** — writes the system configuration rows into the `yp`
   master DB: `sys_conf`, `domain`, `vhost` (ns1/ns2/jit/www/smtp/_acme-challenge/
   _domainkey), `organisation`, `settings`, and the `mailserver` domain/aliases/user.
4. **`createNobody()` / `createGuest()`** — the fixed-UID system accounts.
5. **`createSystemUser()`** — the `system@<domain>` account plus the public **media**
   hub and the **portal** hub.
6. **`createAdmin()`** — the admin account (from `ADMIN_EMAIL` / `ACME_EMAIL_ACCOUNT`,
   else `admin@<domain>`), its internal/external shareboxes, disk-quota sizing (75% of
   free space on the data dir), and a one-time password-reset link printed to the
   console.
7. **`Mfs.importContent("content.drumee.com/Wallpapers")` + `importTutorial()`** —
   downloads wallpapers and tutorial content and registers them in the media hub.
8. **`afterInstall()`** — generates the instance RSA key pair into
   `/etc/drumee/credential/crypto/{public,private}.pem` and renders the welcome page.

## Public API

`index.js` exports three classes:

| Class | File | Responsibility |
|---|---|---|
| `Organization` | `lib/organization.js` | Instance lifecycle — populate system config, create the system/admin/nobody/guest accounts, remove an org. |
| `Drumate` | `lib/drumate.js` | Individual user accounts and their hubs — create/remove users, create hubs, init folders, set wallpaper. |
| `Mfs` | `lib/mfs.js` | Media filesystem — import files/content/tutorials from a remote manifest into a hub. |

## Configuration

Runtime config is assembled in `lib/utils.js:getConfigs()`, which merges a
`defaultConf` block with `sysEnv()` (the values `setup-infra` wrote to `drumee.json`).
A valid `domain` is required or the process aborts.

**Environment variables**

| Variable | Used for |
|---|---|
| `DRUMEE_DOMAIN_NAME` | Primary domain (required). |
| `DRUMEE_DESCRIPTION` | Human-readable organization name. |
| `ADMIN_EMAIL` | Admin account email (falls back to `ACME_EMAIL_ACCOUNT`, then `admin@<domain>`). |
| `ACME_EMAIL_ACCOUNT` | Let's Encrypt / fallback admin email. |
| `FIRSTNAME` / `LASTNAME` | Admin name defaults. |
| `DEBUG` | Enables `debug()` / `banner()` output in `lib/utils.js`. |

**Credential / key files** (under `/etc/drumee/credential/`, written by `setup-infra`):
`db.json`, `postfix.json`, `email.json`, and `crypto/{public,private}.pem` (generated
here during `afterInstall`).

## Conventions

These hold throughout the codebase:

- **Database:** all access goes through `Mariadb` from `@drumee/server-essentials`
  against the **`yp`** master DB, using stored procedures (`await_proc`) plus
  `await_query` / `await_func`. Raw shell `mariadb` calls (in `lib/utils.js`) are used
  only for user creation, grants, and loading the seed `.sql` schemas.
- **IDs:** always `uniqueId()` — never `uuid` or `Math.random()`.
- **Logging:** classes extend `Logger`; use `this.debug()` / `this.warn()`, not
  `console.log`.

## Layout

```
index.js          Public API: Drumate, Mfs, Organization
populate.js       Canonical full-install sequence (executable)
lib/
  organization.js Organization lifecycle
  drumate.js      User accounts & hubs
  mfs.js          Media filesystem import
  utils.js        Config assembly, MariaDB user/schema helpers
  index.js        Common base class
bin/              Post-install CLI scripts (acknowledge, remove-org, …)
asset/welcome.html  Welcome-page template
test/             Standalone scripts run with `node`, not a test runner
```

## Running

```bash
node populate.js     # full install (expects a configured machine)
node test/db.js      # run a single test script
npm run release      # git push + npm publish + npm version patch
```

## License

AGPL V3.
