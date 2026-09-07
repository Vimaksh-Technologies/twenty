# Twenty Dokploy deployment runbook

**Status:** repository deployment contract through U13; all live deployment,
migration, recovery, and mailbox-Open evidence remains `blocked-live` until the named
external gates pass. Bracketed values are required inputs, never observed results.

## Scope and boundary

- Target: <https://twenty.paryatech.in>.
- This is a deployment on the existing shared ParyaTech **staging Dokploy host**.
  It is not a dedicated host; preserve capacity and routing for the other workloads.
- The separate ParyaTech production VM is explicitly out of scope. Do not connect to,
  deploy to, migrate, restart, or otherwise change it from this runbook.
- This document records a read-only preflight from 2026-08-06. It is not authority to
  make DNS, Cloudflare, Dokploy, Docker, R2, or production changes.

## Deployment identifiers

Do not substitute credentials or secret IDs here. The order is deliberate:

1. Before creating any Twenty resource, complete the pre-creation gates and the
   authenticated, read-only Dokploy project lookup. Record the project name/ID.
2. Create the approved Dokploy environment and application.
3. Immediately after creation and before image deployment, record the environment,
   application, and service identifiers below in the protected change record.

| Identifier | Final value |
| --- | --- |
| Dokploy project name / ID | `[record before resource creation, after authenticated read-only lookup]` |
| Dokploy environment name / ID | `[record immediately after creation and before deployment]` |
| Dokploy application name / ID | `[record immediately after creation and before deployment]` |
| Deployment service prefix | `[record immediately after creation and before deployment]` |
| Public URL | `https://twenty.paryatech.in` |
| Database service name | `[record immediately after creation and before deployment]` |
| Redis service name | `[record immediately after creation and before deployment]` |
| Primary R2 bucket | `paryatech-twenty-crm` |
| Backup R2 bucket | `paryatech-twenty-crm-backups` |

Preflight note: an authenticated `GET /api/project.all` identifier lookup was not
completed because the credential source did not yield a usable in-process credential.
Repeat that single read-only call with an approved credential before recording the
project ID. Never put the credential, its value, or a copied request in this document.

## Routing and TLS

### Observed read-only state

- `paryatech.in` is delegated to Cloudflare name servers.
- `twenty.paryatech.in` and a previously unallocated single-label test hostname both
  resolved to the same Cloudflare IPv4 and IPv6 proxy addresses and returned HTTPS 200
  from Cloudflare. This demonstrates public wildcard DNS and ingress behaviour, not
  ownership of an exact Cloudflare DNS record.
- The shared host runs Traefik as the standalone `dokploy-traefik` container, rather
  than as a Swarm service. Its static configuration enables Docker, Swarm, and file
  providers and ACME resolvers.
- The current `prod-wildcard.yml` dynamic route accepts
  `HostRegexp(\`^[a-z0-9-]+\\.paryatech\\.in$\`)`.
- No exact `twenty.paryatech.in` route was found in current Docker labels or Traefik
  dynamic configuration files.

### Required gate before cutover

1. Perform a read-only Cloudflare zone review with an authorized operator. Public DNS
   cannot distinguish an exact proxied record from wildcard synthesis when both return
   the same Cloudflare addresses. Record whether an exact record exists, its intended
   target, and whether it conflicts with the proposed application.
2. Create exactly one Dokploy-managed exact HTTPS route for
   `twenty.paryatech.in`; do not hand-edit Traefik files or replace the shared wildcard
   route.
3. Confirm TLS issuance/renewal and the certificate's hostname after the route exists.
   The existing wildcard response is not evidence that the Twenty application has been
   routed correctly.

## Image and release policy

- Initial official release: `twentycrm/twenty@sha256:61a190e9dda07afc4d3d1b9b53fd1cd8cf23da8dfe4dd1f1176b1cbb0932106e`.
  This is the immutable OCI index digest resolved from `twentycrm/twenty:v2.27.0` on
  2026-08-06. The host's `linux/amd64` manifest observed under that index was
  `sha256:f82a0ffdaa21d0d0d2092e5c26d3716271d0fdff327a1f714fd6722a9e707bf2`.
- Audit store: `clickhouse/clickhouse-server:24.8.14.39-alpine@sha256:b002e56ed5c16e224c312527f6fcba7e77216fec5d7a88a7828f59efc614feb5`.
  The resolved `linux/amd64` manifest is
  `sha256:0aed39f1983c18b4d20c9f2a19dff772e97bab13bc00b8639570950f2c4bfef3`.
- Database: `postgres:16.9-alpine@sha256:7c688148e5e156d0e86df7ba8ae5a05a2386aaec1e2ad8e6d11bdf10504b1fb7`.
- Queue/cache: `redis:7.4.7-alpine@sha256:02f2cc4882f8bf87c79a220ac958f58c700bdec0dfb9b9ea61b62fb0e8f1bfcf`.
- Backup image: build from that exact ClickHouse digest with
  `ca-certificates=20260413-r0`, `curl=8.14.1-r2`, `jq=1.7.1-r0`,
  `postgresql16-client=16.15-r0`, and `rclone=1.68.2-r5`; publish it and set
  `TWENTY_BACKUP_IMAGE_REF` to the resulting `@sha256` identity before deployment.
- Never deploy a floating tag such as `latest`, `main`, or an unpinned version tag.
- Future custom releases use
  `ghcr.io/vimaksh-technologies/twenty:<immutable release-or-SHA>`. Record the release
  identifier, immutable digest, source commit, migration outcome, and deployment time
  in the change record.
- Resolve and review the image digest before every deployment. A tag is provenance
  metadata, not a deployment identifier.

## Service topology and resources

The normal `docker-compose.yml` topology requires separate server and worker processes,
PostgreSQL, Redis, and the ClickHouse audit store. The explicit fast-launch
`docker-compose.core-only.yml` profile omits ClickHouse while
`AUDIT_LOGS_ENABLED=false`; it does not relax or alter the normal topology. Use
Dokploy-managed services and an internal network, and expose only the Twenty HTTP
server through the exact Traefik route.

| Workload | CPU ceiling | Memory ceiling | Notes |
| --- | ---: | ---: | --- |
| Twenty server | 1.25 CPU | 2 GiB | Public HTTP process; the only process allowed to execute PostgreSQL migrations |
| Twenty worker | 0.75 CPU | 1.25 GiB | No public route; PostgreSQL migrations and cron registration disabled |
| PostgreSQL 16 | 1 CPU | 1.5 GiB | Persistent volume; private only; health check required |
| Redis 7.4 | 0.25 CPU | 384 MiB | Private only; set eviction policy to `noeviction`; health check required |
| ClickHouse 24.8 | 0.5 CPU | 1.5 GiB | Persistent data and backup-staging volumes; ports 8123/9000 internal only |
| ClickHouse migration | 0.25 CPU | 512 MiB | One-shot immutable Twenty image; migration URL only; must complete successfully |
| ClickHouse retention | 0.25 CPU | 256 MiB | Operations profile only; delete-only ClickHouse plus metadata-only PostgreSQL; independently monitored |
| Backup | 0.25 CPU | 256 MiB | Normal mode requires read-only PostgreSQL, complete general R2 files, and ClickHouse audit; explicit core-only mode requires PostgreSQL and complete general R2 files |

### Health checks, sequencing, and migrations

1. Start PostgreSQL 16, Redis 7.4, and ClickHouse with health checks. Redis must use
   `noeviction`.
2. After ClickHouse is healthy, compose starts the one-shot `clickhouse-migrate`
   service with only the migration URL and runs `yarn clickhouse:migrate:prod`.
3. Start the Twenty server only after the ClickHouse migration exits successfully and
   PostgreSQL/Redis are healthy. The server is the **only** long-running process that
   may execute PostgreSQL migrations; wait for its migration completion and application
   health check before starting a worker.
4. Configure the Twenty worker with PostgreSQL migrations and cron registration
   disabled. Start it only after `clickhouse-migrate`, dependency health, and server
   health pass.
5. Start backup after PostgreSQL and ClickHouse are healthy and the ClickHouse
   migration has completed. Backup startup is deliberately independent of application
   server health so a server outage cannot prevent core recovery points.
6. Configure the permanent daily Dokploy retention schedule with the operations-profile
   command. Prove its retry, success/failure heartbeat, and stale-success monitor before
   removing any audit rows.
7. Run `yarn command:prod upgrade:status` in the target server-release context and
   parse its result, rather than treating command exit alone as sufficient. Fail closed:
   do not proceed when the result reports a database that is behind, a failed upgrade,
   or any ambiguous/unparseable state. Preserve only a scrubbed status summary in the
   protected change record.

For the audit-disabled fast launch, copy `core-only.env.example` into the protected
Dokploy environment, replace every placeholder, retain
`COMPOSE_PROFILES=core-only`, and validate
`docker compose --env-file <protected-env> -f docker-compose.core-only.yml
--profile core-only config`. This standalone profile starts only server, worker,
PostgreSQL, Redis, and backup; server and worker receive
`AUDIT_LOGS_ENABLED=false`, and backup receives `BACKUP_MODE=core-only`. It contains
no ClickHouse service, dependency, volume, URL, user, or credential. The normal
`docker-compose.yml` remains the ClickHouse-inclusive deployment and explicitly passes
`BACKUP_MODE=clickhouse-inclusive` with `AUDIT_LOGS_ENABLED=true`.

Read-only host observations: the shared host has 4 logical CPUs, 15 GiB RAM with about
4.9 GiB available, 4 GiB swap with about 1.4 GiB in use, and about 56 GiB free on the
root disk. It is an active, single-manager Docker Swarm. The ceilings above are hard
limits, not reservations; verify current host headroom and existing workload impact at
the change window.

### Observed shared-service inventory

Observed through bounded, read-only `timeout 20 sudo -n docker service ls` at
`2026-08-06T14:08:47Z`. These are existing shared-host service names, not Twenty
deployment identifiers:

```text
ai-worker-prod-njyuv1
ai-worker-staging-7rg07s
api-prod-yj9jt6
api-staging-ugp6dz
belo-api-6t6dl0
belo-postgres-n3wsgl
belo-web-krabmo
bunker-postgres-xdjxxr
bunker-web-w2onem
dokploy
dokploy-postgres
inngest-pg-5eql4y
inngest-pg-prod-9rn1bi
inngest-redis-prod-x8osap
inngest-redis-yzy4gx
inngest-server-4v0qrx
inngest-server-prod-kyuiqb
paryatech-pg-prod-x9gt5p
paryatech-pg-staging-aksvc0
paryatech-redis-prod-rwvpt1
paryatech-redis-staging-a1ypow
pr-324-api-sbgbxb
pr-324-web-xoulxz
pr-325-api-cr7ehc
pr-325-web-uztsme
pr-327-api-idy9gb
pr-327-web-sqy23i
scheduler-prod-1cl8zd
scheduler-staging-nb0ne6
super-admin-prod-zlixai
super-admin-staging-gqttgm
web-prod-oqkiol
web-staging-xifk0p
worker-prod-qlayuw
worker-staging-zavgwh
```

The relevant standalone ingress container observed at the same timestamp is
`dokploy-traefik`; it is not a Docker Swarm service. Do not modify any inventory item
while creating or operating Twenty.

## R2, encryption, and recovery-secret boundaries

- Use the separate private staging/Team R2 primary bucket
  `paryatech-twenty-crm` only for Twenty's general object/file storage.
- Use the separate private staging/Team R2 backup bucket
  `paryatech-twenty-crm-backups` only for backup artifacts, checksum indexes,
  manifests, and isolated-restore inputs.
- Do not reuse buckets, credentials, endpoints, or policies from another application.
  Both endpoints must use authenticated HTTPS.
- Before production writes, preserve provider evidence that the primary and backup
  buckets encrypt every object at rest. The backup bucket must additionally enforce
  versioning plus Object Lock or an approved equivalent outside the backup identity,
  and lifecycle expiry equal to the approved retention/deletion-propagation policy.
  Bucket names, `--immutable`, or successful uploads are not encryption or immutability
  evidence.
- Prove encryption at rest for the host/device backing PostgreSQL, ClickHouse,
  `server-local-data`, Docker runtime state, and ClickHouse backup staging. Record only
  provider/device identities, encryption state, recovery/key owner, and evidence
  location in the protected operations record; never record keys.
- Every local import/export, restore input, SQL verification file, and generated report
  containing CRM data must remain on approved encrypted storage with root `0600` mode
  (or the approved individual non-root owner for inert import tooling), an owner,
  retention, and verified deletion. Unencrypted downloads or operator-home copies fail
  the restricted-data gate.
- Keep bucket IDs, access keys, secret keys, account identifiers, endpoints, object
  listings, and business-bearing checksum indexes out of Git, tickets, shell history,
  screenshots, and copied Dokploy output.

## Secrets and recovery handling

- Store runtime secrets only in the approved Dokploy secret/integration mechanism.
  Reference secret names in the change record only when they reveal no value or
  provider identifier.
- Treat database passwords, Redis credentials, application encryption keys, JWT/auth
  secrets, Google/SMTP credentials, every ClickHouse URL/password, R2 credentials,
  healthcheck URLs, and Cloudflare/Dokploy credentials as secrets. Do not echo them
  with `env`, `inspect`, compose exports, screenshots, or support bundles.
- Dokploy must mount `../files/twenty-backup.env` as
  `/run/secrets/twenty-backup.env`. Before sourcing it, the backup entrypoint verifies
  that the resolved regular file is readable, owned by numeric UID/GID `0:0`, and mode
  exactly `0600`; failure exits without printing its metadata or contents. Record the
  non-secret pass/fail and second-administrator witness in the protected change record.
  In core-only mode this file contains only primary-R2 read and backup-R2 write
  credentials; any ClickHouse URL, host, user, database, or credential fails preflight.
  The normal ClickHouse-inclusive mode retains its existing ClickHouse backup settings.
- Keep two authorized recovery administrators able to retrieve the recovery material
  through the approved secret manager. Administration is not their daily role. Test
  the second administrator's access and rotation path without revealing a value.
- A lost application encryption key or incompatible restored secret set can make data
  unrecoverable. Test the exact protected secret set in an isolated environment before
  relying on it.

## Google Workspace and low-volume SMTP gates

The compose file accepts only the Twenty v2.27 configuration names below. The
Dokploy variable name is the secret/config reference; its value belongs in the
approved secret manager and must never be copied into Git, a change record, command
output, screenshot, or shared log.

| Dokploy variable name | Required effective configuration |
| --- | --- |
| `MESSAGING_PROVIDER_GMAIL_ENABLED` | `false` in production through Release A; enable only for an approved staging smoke or Release B mailbox opening |
| `CALENDAR_PROVIDER_GOOGLE_ENABLED` | `false` in production through Release A; enable only for an approved staging smoke or Release B calendar opening |
| `MESSAGING_INITIAL_SYNC_LOOKBACK_DAYS` | Exactly `90` on server and worker; this configures the bounded initial window but does not open Gmail or claim U8 acceptance |
| `AUTH_GOOGLE_CLIENT_ID` | Protected Google OAuth client identifier; record the secret name and owner, never the value |
| `AUTH_GOOGLE_CLIENT_SECRET` | Protected Google OAuth client secret; record the secret name and owner, never the value |
| `AUTH_GOOGLE_CALLBACK_URL` | Exactly `https://twenty.paryatech.in/auth/google/redirect` |
| `AUTH_GOOGLE_APIS_CALLBACK_URL` | Exactly `https://twenty.paryatech.in/auth/google-apis/get-access-token` |
| `EMAIL_FROM_ADDRESS` | Exactly `team@paryatech.in` after SMTP activation |
| `EMAIL_FROM_NAME` | Approved Paryatech sender display name |
| `EMAIL_DRIVER` | `LOGGER` until U10 passes; `SMTP` may be used for Release A only after U10 |
| `EMAIL_SMTP_HOST` | Approved provider host reference |
| `EMAIL_SMTP_PORT` | Approved authenticated TLS endpoint port |
| `EMAIL_SMTP_USER` | Protected credential for the real `team@paryatech.in` sender |
| `EMAIL_SMTP_PASSWORD` | Protected SMTP password/app-password reference |
| `EMAIL_SMTP_NO_TLS` | `false`; do not approve a plaintext or TLS-optional test result |

The compose defaults preserve the existing closed state: Google providers are disabled,
the application email driver is `LOGGER`, and credential references are blank. Before
activating a provider, populate every applicable reference in Dokploy and deploy the
same configuration to server and worker. Because database-backed configuration is
enabled, an administrator must also verify that Server Admin has no stale override for
these names; a database value takes precedence over Dokploy. Use one approved source of
truth and record only the effective source and a pass/fail result.

`EMAIL_FROM_*` and `EMAIL_SMTP_*` configure Twenty's application email driver (for
example invitations and password resets), not a CRM-contact campaign transport. Twenty
v2.27 provides no supported environment variable for folder selection, internal-email
exclusion, contact auto-creation, calendar selection, delivery-status ingestion,
bounce/reply ingestion, or campaign limiting. Apply the manual controls below; do not
invent environment flags. SMTP submission acceptance is not final delivery, does not
make an Agency Contacted or Engaged, and must not be used for campaigns, sequences, bulk
mail, or blind retries. Until a separately verified record-specific sending path exists,
customer outreach remains an external send with a manual CRM communication record.

### Google consent, connection, and scope

1. In the approved Google Cloud project, configure an Internal OAuth consent screen for
   the Paryatech Workspace organization. Authorize only the real human-operated
   `team@paryatech.in` mailbox account; do not substitute an alias, service account, test
   identity, or a shared Twenty login.
2. Register both exact HTTPS callbacks from the table. Reject any callback with another
   host, scheme, path, query, wildcard, or trailing slash.
3. Approve only the scopes requested by Twenty v2.27: `email`, `profile`,
   `https://www.googleapis.com/auth/gmail.readonly`,
   `https://www.googleapis.com/auth/calendar.events`,
   `https://www.googleapis.com/auth/profile.emails.read`,
   `https://www.googleapis.com/auth/gmail.send`, and
   `https://www.googleapis.com/auth/gmail.compose`. Record consent-screen version,
   administrator, scope set, and pass/fail without tokens or consent screenshots that
   expose account data.
4. Release A keeps both Google provider variables `false` and has no active production
   mailbox/calendar sync. For staging, use a scrubbed sandbox account and close it after
   the smoke. Connect the true mailbox only during the approved Release B opening under
   an individual administrator's Twenty session.
5. Before completing the connected-account configuration, choose **Some folders** /
   **Import only selected folders/labels** and select only the approved customer-facing
   Inbox, Sent, and customer labels. Do not select Drafts, Spam, Trash, private/internal
   labels, or any catch-all label. In Settings > Security, keep **Sync Internal Emails**
   off. In the message channel, set **Contact auto-creation** to **None**.
6. In the calendar channel, turn **Auto-creation** off. Twenty v2.27 reads only the
   Google account's `primary` calendar; it cannot select a different calendar with an
   environment variable. The primary calendar for this account must therefore be a
   dedicated, approved customer-facing calendar. Keep private and all-internal events
   on other calendars, and admit descriptions or attachments only after broad-visibility
   review.
7. Confirm the named data owner's acceptance that approved message bodies and calendar
   content are broadly visible to operators. Do not complete configuration or start
   synchronization before the Release B gate records this acceptance and U8 passes.

Deleting a connected account in Twenty is not proof that Google revoked its grant. For
planned revocation, first disable both provider variables and redeploy server and worker,
delete the connected account in Settings > Accounts, revoke the app grant in Google
Workspace/Google Account administration, and verify a reconnect requires fresh consent.
For client-secret rotation, add a replacement secret at Google, update the protected
Dokploy reference, redeploy both processes, reconnect and repeat the scope/callback
smoke, then revoke the old secret. Client-ID rotation must register both callbacks and
repeat consent. Record only secret versions/fingerprints allowed by policy, never values.

### SMTP acceptance and failure evidence

After U10 passes, test `EMAIL_DRIVER=SMTP` in staging with the approved authenticated
TLS endpoint and a controlled canary recipient:

1. Prove TLS negotiation, hostname validation, authenticated submission, the expected
   From address, and provider acceptance. Preserve a scrubbed provider submission ID,
   timestamp, environment, and related CRM record/event reference.
2. Prove an invalid credential and an unreachable endpoint produce a local failure.
   Stop; do not replay until the Shared Exception has an owner, the last trusted state,
   evidence, and an explicit resume decision.
3. Prove an accepted message can later bounce and that a reply can arrive. Reconcile
   provider delivery/bounce evidence and the human-observed reply manually; acceptance
   alone stays provider-accepted, a bounce is not Contacted, and only a reply/two-way
   interaction may establish Engaged.
4. Inspect server and worker logs for the test window, then redact recipient addresses,
   message content, authorization data, credentials, tokens, and provider payloads before
   attaching evidence. Never use an environment dump or Docker inspection output.
5. Return `EMAIL_DRIVER` to `LOGGER` after a staging test. Production may switch to
   `SMTP` only after U10 and an approved Release A change record; Gmail and Calendar
   remain disabled until Release B.

Twenty v2.27's SMTP driver logs asynchronous submission success/failure but does not
expose a delivery receipt, bounce, or reply contract to CRM records. Provider evidence
and the manual reconciliation above are mandatory; this limitation blocks treating SMTP
as delivery or automated contact evidence.

### Emergency halt and staging smoke

On suspected grant/credential exposure, wrong-folder import, internal/private content
sync, duplicate send, or unexplained SMTP state:

1. Set both Google provider variables to `false` and `EMAIL_DRIVER` to `LOGGER`; redeploy
   server and worker with the immutable approved image. Keep `LOGIC_FUNCTION_TYPE` and
   `CODE_INTERPRETER_TYPE` at `DISABLED`.
2. Delete the Twenty connected account, revoke the Google grant, revoke/rotate the SMTP
   credential, and preserve the last trusted state. Do not reconnect or resend.
3. Open a Shared Exception naming the affected capability, evidence, owner, due/escalation,
   and explicit resume gate. Broader sensitive-data rollout stops for exposure,
   unreconstructable state, or recovery/monitoring failure.

The staging smoke must cover: consent and exact callback success; missing-scope and
callback-mismatch rejection; revoke and fresh-consent reconnect; credential rotation;
only the selected customer folders; no Drafts/Spam/Trash/private/internal or all-internal
mail; the dedicated primary calendar with no private/all-internal events; both
auto-creation controls off; SMTP TLS/authentication, acceptance, local failure, bounce,
and reply reconciliation; redacted logs; and the emergency halt. Record environment,
immutable image digest, actor, expected/observed result, timestamp, scrubbed evidence
location, and pass/fail. This smoke is not authority for a live deploy.


## ClickHouse audit and entitlement gate

ClickHouse is an internal audit store, not a public service. The compose file publishes
no host port; only containers on the private application network may reach HTTP 8123 or
native TCP 9000. Its data and backup-staging volumes must reside on storage whose
provider-level encryption at rest has been proved. A Docker volume name is not evidence
of encryption. Record the encrypted volume/device identity, key owner, recovery access,
and test result in the protected change record before accepting audit data.

The hardened audit release requires `AUDIT_LOGS_ENABLED=true` and exactly two
env-only runtime URLs on server and worker. Hardened mode never falls back to legacy
`CLICKHOUSE_URL`; leave that legacy variable absent.

| Process variable | Required identity and capability |
| --- | --- |
| `CLICKHOUSE_INGEST_URL` | Normal runtime only: `twenty_ingest` on `twenty`; `INSERT` only |
| `CLICKHOUSE_READ_URL` | Normal runtime only: `twenty_audit_reviewer` on `twenty`; `SELECT` only |
| `CLICKHOUSE_MIGRATION_URL` | One-shot migration only: `twenty_migration`; scoped schema/migration grants on `twenty.*` |
| `CLICKHOUSE_RETENTION_URL` | Operations-profile retention only: `twenty_retention`; `ALTER DELETE` on `twenty.*` only |

Server and worker require only ingest/read and must not receive migration, retention,
backup, restore, or loopback credentials. The one-shot processes reject missing
role-specific URLs rather than falling back to another role. Store each whole URL as a
separate Dokploy secret, never print it, and never alias one identity into another.
The ClickHouse user configuration reads passwords only through these `from_env`
references:

| Secret/config reference | Purpose and allowed capability |
| --- | --- |
| `CLICKHOUSE_ADMIN_PASSWORD` | Loopback-only break-glass ClickHouse administrator |
| `CLICKHOUSE_INGEST_PASSWORD` | `twenty_ingest`: `INSERT` on `twenty.*` only |
| `CLICKHOUSE_AUDIT_REVIEWER_PASSWORD` | `twenty_audit_reviewer`: `SELECT` on `twenty.*` only |
| `CLICKHOUSE_MIGRATION_PASSWORD` | `twenty_migration`: one-shot create/select/insert/alter/drop schema work on `twenty.*`; no user/grant management |
| `CLICKHOUSE_RETENTION_PASSWORD` | `twenty_retention`: `ALTER DELETE` on `twenty.*` only |
| `CLICKHOUSE_BACKUP_PASSWORD` | `twenty_backup`: `SELECT` and `BACKUP` on `twenty.*` only |
| `CLICKHOUSE_RESTORE_PASSWORD` | `twenty_restore`: `BACKUP` on `twenty.*` plus create/insert/select only on `twenty_restore_validation.*` |

Compose runs the immutable Twenty image once as `clickhouse-migrate` with only
`AUDIT_LOGS_ENABLED=true` and `CLICKHOUSE_MIGRATION_URL`. It waits for ClickHouse
health and executes `yarn clickhouse:migrate:prod`; server and worker wait for its
successful completion. A failed or ambiguous migration prevents both processes from
starting.

Retention is not registered in the normal server/worker cron queues. A permanent
Dokploy schedule runs
`docker compose --profile operations run --rm clickhouse-retention`; that bounded
process receives only the delete-only ClickHouse URL, a metadata-only PostgreSQL URL,
and distinct success/failure heartbeat routes. Configure a daily schedule with
overlapping runs disabled and a 30-minute external execution deadline. The process
uses a 15-second PostgreSQL connection timeout, 60-second PostgreSQL/ClickHouse query
timeouts, and a 10-second heartbeat timeout. It retries each mutation three times,
waits five seconds between attempts, requires synchronous mutation completion, sends
success only after every active workspace/table passes, and sends failure after any
exhausted retry or bounded-identity check. Missing/late success, including forced
deadline termination, independently alerts. Do not add any destructive ClickHouse
credential to server or worker.

Migration, retention, backup, and restore identities have no user/grant-management
privilege. Migration can create only `twenty`; retention cannot select or change
schema; backup cannot restore or mutate; restore can create/insert/select only in the
fixed `twenty_restore_validation` database. The loopback-only administrator is
reserved for separately approved recovery/cleanup and is not a process URL.

### Enterprise and content gates

There is no deployment variable that grants the Enterprise `AUDIT_LOGS` entitlement.
Before enabling `AUDIT_LOGS_ENABLED`, obtain and validate the real entitlement on the
pinned Twenty release. With entitlement absent, verify that the application rejects
audit-log access as Enterprise-only and record **Fail / rollout blocked**. Never
fabricate a license, toggle an unrelated feature flag, or treat a reachable ClickHouse
server as entitlement.
Missing/expired entitlement blocks U9 plus all high-risk capabilities and broad
restricted-data rollout.

In staging, after schema migration, prove that representative object and administrator
events reach ClickHouse; `twenty_ingest` can insert but cannot select/alter/delete;
`twenty_audit_reviewer` can select but cannot insert/alter/delete; `twenty_retention`
can run bounded `ALTER DELETE` but cannot select/drop/create; `twenty_backup` can back
up but cannot restore/mutate; and `twenty_restore` can restore only to
`twenty_restore_validation` and cannot alter/delete restored rows. Record query classes
and pass/fail, not SQL containing business values.

Audit payloads may contain approved identifiers, event classification, actor, reason,
and evidence references only. Authentication data, environment/config values, message
bodies, attachment content, payment-instrument data, bank/UPI credentials, unnecessary
PII, and classified restricted content are prohibited. Sample server, worker, and
ClickHouse logs plus audit rows in staging and fail the gate on any such content. This
is an operational/content contract, not an XML filter.

### Audit backup, retention, and restore

The backup process uses `CLICKHOUSE_BACKUP_HOST`, `CLICKHOUSE_BACKUP_USER`,
`CLICKHOUSE_BACKUP_PASSWORD`, and `CLICKHOUSE_BACKUP_DATABASE` from the protected
`twenty-backup.env`; use `twenty_backup` and database `twenty`. It requests a native
ClickHouse ZIP archive at `audit/<UTC timestamp>.zip` on the shared `audit_backups`
disk. On the pinned ClickHouse image this destination is one regular archive file, not
a directory; the script requires that file, verifies SHA-256 after an immutable
external upload, and records only its external identity and checksum in the core
manifest.
Application, reviewer, and backup identities remain unable to restore or mutate.

The backup R2 bucket must enforce provider-side encryption, versioning/Object Lock or
an approved equivalent that prevents overwrite/deletion by the backup identity, and a
separately authorized lifecycle matching the approved retention/deletion-propagation
inputs. Script-level `--immutable` detects collisions; it does not establish external
immutability.

### PostgreSQL backup and retention identities

Never inject the application `PG_DATABASE_URL` into backup or retention. Provision
`twenty_backup` as a separate login with `NOSUPERUSER NOCREATEDB NOCREATEROLE
NOREPLICATION NOBYPASSRLS`, `CONNECT` on the `twenty` database, membership in
PostgreSQL's predefined `pg_read_all_data` role, and
`default_transaction_read_only=on`. Set `BACKUP_PG_DATABASE_URL` to that identity,
`BACKUP_PG_DATABASE_USER=twenty_backup`, and `APP_PG_DATABASE_USER` to the distinct
application role name. The backup entrypoint rejects `PG_DATABASE_URL`, aliased role
names, elevated role attributes, a writable transaction, or discovered table write
privileges before `pg_dump`.

Before deployment, a recovery administrator must separately prove that the application
connection reports `current_user=PG_DATABASE_USER`; pass only that non-secret role name
to backup/retention for alias rejection.

Provision `twenty_retention` separately with the same non-elevated role attributes,
`CONNECT` on `twenty`, `USAGE` on schema `core`, `SELECT` on
`core.workspace(id, "eventLogRetentionDays", "activationStatus")`, and
`default_transaction_read_only=on`; grant no other table access. Use it only in
`RETENTION_PG_DATABASE_URL` with
`RETENTION_PG_DATABASE_USER=twenty_retention`. Before activation, prove
`twenty_backup` completes a custom-format `pg_dump` but cannot insert/update/delete,
and prove `twenty_retention` reads the three approved workspace columns but cannot
read unrelated tables or write. Record only role names, query classes, and pass/fail.

## Backup policy, manifest, and failure contract

The deployment must supply every input below from the approved CRM Operating Policy.
`clickhouse-inclusive` remains the default backup mode. `core-only` is accepted only
when explicitly selected with `AUDIT_LOGS_ENABLED=false`; it rejects any ClickHouse
connection or credential and fixes both retention values at 30 days. There are no
silent cadence or recovery defaults.

| Variable | Required contract |
| --- | --- |
| `BACKUP_MODE` | Omit or set `clickhouse-inclusive` for the existing full path; set exact `core-only` only for the audit-disabled profile |
| `AUDIT_LOGS_ENABLED` | Exact `true` for ClickHouse-inclusive mode; exact `false` for core-only mode |
| `TWENTY_BACKUP_IMAGE_REF` | Published backup image pinned by `@sha256`; compose and the manifest use the same identity |
| `BACKUP_PG_DATABASE_URL` | Required `twenty_backup` URL; distinct read-only identity, never the application URL |
| `BACKUP_PG_DATABASE_USER` | Exact expected backup role name checked against the connected PostgreSQL identity |
| `APP_PG_DATABASE_USER` | Non-secret application role name used only for alias rejection |
| `TWENTY_IMAGE_REF` | Exact immutable application image deployed to server and worker |
| `TWENTY_APP_RELEASE` | Approved Release A/B identifier containing no customer data |
| `BACKUP_INTERVAL_SECONDS` | Positive cadence; cannot exceed `RECOVERY_RPO_MINUTES × 60` |
| `BACKUP_RETENTION_DAYS` | Positive protected retention; exact `30` in core-only mode; otherwise cannot exceed deletion propagation |
| `DELETION_PROPAGATION_DAYS` | Positive maximum time for deleted CRM content to age out; exact `30` in core-only mode |
| `RECOVERY_RPO_MINUTES` | Approved maximum recoverable-data gap |
| `RECOVERY_RTO_MINUTES` | Approved maximum time to restore and verify core service |
| `BACKUP_HEALTHCHECK_URL` | Secret success route called only after every core verification and manifest upload passes |
| `BACKUP_FAILURE_HEALTHCHECK_URL` | Separate secret failure route called on any armed backup failure |

One run uses a single UTC timestamp. Both modes create the PostgreSQL custom-format
dump and SHA-256, count and total the complete primary general-file bucket, build and
hash its canonical downloaded checksum index, immutably upload every artifact, download
and verify each artifact, immutably upload/download-compare the scrubbed manifest, and
only then send success. ClickHouse-inclusive mode retains its native ClickHouse backup,
checksum, immutable upload, download verification, and schema-1 manifest fields.
Core-only mode performs no ClickHouse command or storage operation and writes a strict
schema-2 manifest with `mode: core-only`, PostgreSQL and general-file identities and
checksums, general-file count/bytes, immutable application and backup image identities,
application release, timestamp, and the fixed 30-day retention/deletion policy.

Once a valid HTTPS failure-heartbeat endpoint is configured, any other failed
executable preflight, dump, source inventory, native audit backup when applicable,
copy, collision-safe immutable upload, count, checksum, download verification,
manifest creation, manifest upload, or manifest comparison exits nonzero, sends the
separate failure heartbeat, and never sends success. An absent or invalid failure
endpoint cannot report to itself, so the independent stale/missing-success alert
remains mandatory. Neither manifest mode contains credentials, endpoints, healthcheck
URLs, object keys, actor/customer identifiers, sampled CRM values, or PII. The
encrypted checksum index can contain object keys and is therefore protected as
business data rather than copied into tickets or audit evidence.

Retention is enforced by the externally protected bucket lifecycle/Object Lock policy,
not by delete permission on the backup identity. A successful script run is not proof
that lifecycle, deletion propagation, encryption, or immutability is configured.

### Safe isolated core restore

The executable `verify-core-restore <UTC timestamp>` command restores only to explicitly
isolated targets. It requires `ALLOW_ISOLATED_RESTORE=YES`, rejects the backup-source
PostgreSQL URL, and verifies that PostgreSQL reports the fixed
`twenty_restore_validation` database with no non-system relations. A schema-2
core-only manifest restores and verifies PostgreSQL plus the complete general-file
snapshot without accepting ClickHouse inputs. A schema-1 ClickHouse-inclusive manifest
retains the existing isolated ClickHouse target, identity, artifact, and verification
requirements. The command rejects a manifest whose mode differs from `BACKUP_MODE`,
never drops or overwrites a database, and leaves restored databases in place for
two-administrator review and separately approved cleanup.

Prepare these root-owned `0600` inputs in approved encrypted temporary storage without
printing them:

1. the normal backup secret file; core-only contains only primary/backup R2
   credentials, while ClickHouse-inclusive also contains `twenty_backup` settings;
2. a separate restore secret file containing the isolated PostgreSQL URL;
3. a PostgreSQL verification SQL file whose assertions fail unless sampled core
   relations, object metadata, role/permission assignments, and notification-only
   workflow definitions match the protected expected report; and
4. a two-line general-file spec containing one non-sensitive representative relative
   object key and its approved SHA-256.

ClickHouse-inclusive restore additionally requires the separately held
`twenty_restore` identity/password and fixed target in the restore secret plus a
ClickHouse verification SQL file. Core-only restore rejects those settings.

Run the exact published backup image as a one-off job on an isolated network with the
protected files mounted read-only and command
`verify-core-restore <UTC timestamp>`. Mount ClickHouse backup staging only for the
ClickHouse-inclusive mode. The harness:

- validates the scrubbed manifest shape, mode, and exact timestamp-bound identities;
- downloads and checks the PostgreSQL dump before an atomic, single-transaction
  `pg_restore`, then runs the assertion-only PostgreSQL SQL file with stop-on-error;
- restores the complete general-file snapshot locally, compares its canonical checksum
  index/count/bytes, and verifies the representative upload SHA-256;
- for ClickHouse-inclusive manifests only, downloads/checks the native audit artifact,
  restores it under the new validation database, and runs the assertion-only
  ClickHouse SQL; and
- emits only a generic mode-specific pass line. Query output is suppressed.

The first recovery administrator performs the run; the second independently retrieves
the approved inputs, reviews manifest/image/policy identity, reruns the bounded sample,
and records pass/fail. Record environment, source and restore database identities,
manifest identity, image digests, policy version, expected/observed sample counts,
duration versus RTO, backup age versus RPO, evidence location, both administrators, and
explicit resume decision without recording data or secrets.

This restore always proves PostgreSQL and Twenty general R2 files/uploads; the
ClickHouse-inclusive mode also proves ClickHouse audit. Gmail message-attachment
retrieval, authorization, mirror deletion, backup, and restore remain U8/U13 acceptance
and are neither blocked on nor claimed by this command. Never use this procedure
against live targets, and never use Docker volume removal, database reset, or R2
deletion as a recovery shortcut.

## Monitoring

Every monitor must exist before production writes and carry a permanent primary owner,
secondary owner, destination, acknowledgement window, and escalation route in the
restricted CRM Operating Policy. A temporary personal inbox or an unowned dashboard
does not pass.

| Surface | Required signal and failure route | Permanent accountable route |
| --- | --- | --- |
| Public TLS | External HTTPS/hostname probe, certificate expiry and renewal failure | Platform owner → second recovery administrator |
| Twenty server | `/healthz`, restart loop, sustained 5xx/latency, CPU/memory ceiling | Platform owner → second recovery administrator |
| Twenty worker | process heartbeat, queue lag/depth, failed/stalled jobs, restart loop | Platform owner → application owner |
| PostgreSQL | `pg_isready`, connections, errors, volume growth/free space, backup/restore age | Primary recovery administrator → second recovery administrator |
| Redis | authenticated availability, restart, memory/noeviction pressure and command failure | Platform owner → second recovery administrator |
| ClickHouse | availability, ingestion/backup denial, entitlement/query/retention failure, data and staging free space | Audit owner → recovery administrators |
| Audit retention | immediate failure heartbeat, missing success, exhausted mutation retry, age beyond daily cadence | Audit owner → recovery administrators → security/data owners |
| General and backup R2 | authenticated read/write/check failure, quota, encryption/lifecycle/Object Lock drift | Data owner → recovery administrators and security owner |
| Host disk/swap/capacity | root/data free space, inode pressure, swap use, sustained CPU/RAM versus ceilings | Platform owner → second recovery administrator |
| Google OAuth and SMTP | consent/revocation/auth errors, sync staleness, TLS/send failure, bounce/reply reconciliation backlog | Integration owner → security owner and operations owner |
| Core backup | immediate failure heartbeat, missing success, and age greater than cadence plus approved grace/RPO | Primary recovery administrator → second recovery administrator → security/data owners |

An immediate failure heartbeat and a stale/missing-success alert use distinct monitor
states but enter the same owned Shared Exception path. The first owner acknowledges
inside the approved window; no acknowledgement pages the secondary. Continued outage,
RPO/RTO risk, encryption/immutability drift, unreconstructable records, or restricted
exposure escalates to the security/data owners and pauses the broader sensitive-data
rollout. Recovery does not resume work silently: close the monitor, reconcile the last
trusted state, attach scrubbed evidence, and record the explicit resume action; recurrence
reopens the same exception.

Logs and alert payloads must be scrubbed before sharing. Never include authorization
headers, cookies, database or ClickHouse URLs, R2 credentials/endpoints, healthcheck
URLs, object keys, customer data, or secret environment values.

## Bootstrap and first administrator

1. Complete the identity, routing/TLS, R2, secret, backup, capacity, health-check, and
   migration-status gates above.
2. Before the first public bootstrap session, install a temporary protected access gate
   using Traefik Basic Auth. This is the chosen path. Deliver the access credential only
   through an approved out-of-band channel, never through Git, logs, tickets, shell
   history, screenshots, or copied configuration.
3. Use an SSH-tunnel fallback **only** if Traefik Basic Auth cannot safely be used;
   record why Basic Auth was unsafe and the fallback authorization in the protected
   change record. Do not expose a temporary public route without one of these gates.
4. Deploy the pinned initial images with seven normal services plus the isolated
   operations-profile retention job, persistent PostgreSQL/ClickHouse storage, private
   internal connections, and documented startup order.
5. Run only the Twenty-supported initialization/migration command for the pinned
   release, recording its success without copying sensitive output.
6. Create the first administrator through the supported Twenty bootstrap flow. Record
   the accountable operator in the protected change record; do not record the email,
   password, or session data here.
7. Before explicit authorization to remove the temporary access gate, prove that an
   unauthenticated user is blocked and cannot create a workspace. Record only the
   non-secret test outcome. Remove or relax the gate only after that proof and explicit
   authorization have been recorded.
8. Verify login, a basic create/read workflow, worker processing, private upload access,
   and backup creation before inviting further users.

## Operating and upgrade procedure

1. Open a change record containing the desired immutable image digest, source release,
   expected migrations, rollout owner, rollback criteria, and verification window.
2. Recheck host headroom, Swarm/Traefik health, exact DNS/route ownership, TLS,
   encryption evidence for every volume/R2 bucket/export/backup, protected R2
   retention/immutability, valid `AUDIT_LOGS` entitlement, ClickHouse identity
   separation, permanent alert ownership, and a fresh verified
   PostgreSQL/general-R2/ClickHouse backup and isolated core restore. Stop if any gate
   is uncertain.
3. Test the exact Twenty, backup, and ClickHouse images plus both migration paths in an
   isolated non-production environment.
4. Run and parse `yarn command:prod upgrade:status` for the target server release. Fail
   closed for behind, failed, or ambiguous status; resolve the state before deployment.
5. Deploy the pinned compose through Dokploy, keeping documented resource limits
   unchanged unless a separately approved capacity change exists.
6. Verify PostgreSQL/Redis health → server PostgreSQL migration/health → worker startup.
   In ClickHouse-inclusive mode, insert ClickHouse health and the one-shot migration
   before server startup; keep server/worker stopped if that migration fails.
7. In ClickHouse-inclusive mode, run the operations-profile retention job and prove
   its bounded credentials, retries, heartbeats, and stale monitor. Core-only mode has
   no ClickHouse retention job.
8. Watch the enabled services: always migrations, server/worker, PostgreSQL, Redis,
   HTTP/TLS, general/backup R2, backup, and error rates; add ClickHouse audit,
   ingestion, denial, retention, and health only in ClickHouse-inclusive mode.
9. Run the deployment verification checklist. If rollback criteria are met, stop the
   rollout, preserve logs, and use the approved restore/rollback plan rather than
   improvising data changes.

## Troubleshooting and safe prohibitions

- **Do not touch the separate ParyaTech production VM.**
- Do not edit shared wildcard Traefik files, restart shared Traefik, remove Docker
  services/volumes/networks, run `docker system prune`, or manually deploy a competing
  container on the shared host.
- Do not create, alter, or delete Cloudflare DNS records, Cloudflare routes, certificates,
  R2 buckets, R2 data, or Dokploy projects as part of diagnosis without an approved
  change.
- Do not use an exact Twenty DNS record to bypass the documented routing review. The
  public wildcard currently catches the name, so a new exact route must be intentional.
- Do not expose PostgreSQL, Redis, ClickHouse 8123/9000, worker, management ports, or
  Traefik dashboards.
- Do not paste Docker inspection output, environment dumps, tokens, backup URLs, or
  credentials into this document or issue comments.

## Deployment verification checklist

- [ ] Authenticated read-only Dokploy project lookup completed; final identifiers recorded in the protected change record.
- [ ] Authorized read-only Cloudflare zone review confirms exact/wildcard DNS ownership and no conflict.
- [ ] Dokploy exact route for `twenty.paryatech.in` is present and no duplicate route exists.
- [ ] HTTPS serves the intended Twenty deployment with a valid hostname certificate.
- [ ] Twenty, backup, PostgreSQL, and Redis images are pinned to immutable digests; ClickHouse is also pinned only for ClickHouse-inclusive mode; application release, source release, rollback digest, and platform manifests are recorded.
- [ ] Enabled server, worker, PostgreSQL 16, Redis 7.4, backup, and conditional ClickHouse services use the documented ceilings; only the server is publicly routed.
- [ ] PostgreSQL/Redis health checks pass. Core-only starts server migration/health then worker; ClickHouse-inclusive additionally requires ClickHouse health and successful `clickhouse-migrate` first.
- [ ] `yarn command:prod upgrade:status` was parsed in the target server-release context and is neither behind, failed, nor ambiguous.
- [ ] PostgreSQL persistence and private connectivity are verified; ClickHouse-inclusive mode also verifies ClickHouse persistence and unexposed ports.
- [ ] Primary and backup R2 buckets are distinct, private, least-privilege, and usable without disclosing credentials.
- [ ] Google/SMTP configuration uses only documented variables; `MESSAGING_INITIAL_SYNC_LOOKBACK_DAYS=90` is present on server/worker; secrets are absent from Git/logs/screenshots/exports/change records; no stale Server Admin override exists.
- [ ] Both exact Google callbacks and approved seven-scope consent pass in staging; revoke requires fresh consent and rotation invalidates the retired credential.
- [ ] Release A keeps Gmail and Calendar disabled; Release B alone may connect `team@paryatech.in` after U8 mailbox/file authorization, cleanup, backup, and restore acceptance.
- [ ] SMTP remains `LOGGER` until the live U10 gate; activation proves authenticated TLS, local failure, provider acceptance, bounce/reply reconciliation, redacted evidence, and no campaign/contact-count interpretation.
- [ ] `LOGIC_FUNCTION_TYPE` and `CODE_INTERPRETER_TYPE` remain `DISABLED` on server and worker.
- [ ] Core-only records ClickHouse/AUDIT_LOGS as explicitly deferred, sets `AUDIT_LOGS_ENABLED=false`, admits no ClickHouse URL/credential, and keeps high-risk/broad restricted rollout closed. ClickHouse-inclusive instead requires the real entitlement and all existing ingest/read/migration/retention/backup/restore denial probes.
- [ ] The selected compose contract is exact: standalone `docker-compose.core-only.yml` with profile `core-only`, or normal `docker-compose.yml` with `BACKUP_MODE=clickhouse-inclusive`; never mix their services, manifests, or secrets.
- [ ] PostgreSQL, `server-local-data`, Docker state, both R2 buckets, retained exports, and backups have provider/device encryption and recovery-key evidence; ClickHouse data/staging is included only when enabled.
- [ ] `twenty-backup.env` is verified as root:root `0600` without output; both recovery administrators prove protected independent access.
- [ ] `PG_DATABASE_URL` is absent from backup; `twenty_backup` passes `pg_dump` but cannot write and differs from the application role. ClickHouse-inclusive mode separately proves its retention identity.
- [ ] Core-only uses exact backup/deletion retention `30/30`; cadence/RPO/RTO and the external encrypted immutable lifecycle pass. ClickHouse-inclusive retains its approved positive retention inputs.
- [ ] PostgreSQL, complete general R2 copy/checksum-index/count, every immutable upload/download verification, and scrubbed manifest complete before success; ClickHouse-inclusive also requires the native audit archive. Each forced preflight/store/upload/manifest/tamper failure sends failure and suppresses success.
- [ ] The manifest records exact mode/artifact identities/checksums/counts/bytes/application and backup image digests/release/policy inputs and no secret, endpoint, PII, CRM value, or object key.
- [ ] One externally immutable encrypted backup passes isolated restore for PostgreSQL relations/metadata/roles/workflows and complete general-file checksum inventory plus representative upload; ClickHouse-inclusive also passes audit table/count/classification checks.
- [ ] Gmail attachment backup/restore remains separately closed until U8/U13; U10 evidence does not claim it.
- [ ] Temporary Traefik Basic Auth was used for bootstrap (or the explicitly authorized SSH-tunnel fallback); its credential was delivered outside Git and logs.
- [ ] Before the access gate was explicitly removed or relaxed, a non-secret test proved that unauthenticated users could not create a workspace.
- [ ] First administrator bootstrap, login, record workflow, upload workflow, and worker job all succeed.
- [ ] Every enabled TLS/server/worker/PostgreSQL/Redis/R2/disk/swap/capacity/OAuth/SMTP/backup-age/failure monitor has permanent owners, destination, acknowledgement, escalation, and Shared Exception resume evidence; ClickHouse monitors are required only when ClickHouse is enabled.
- [ ] Change record includes the deployed digest, migration result, verification result, and rollback decision.

## U13 integrated Release A and Release B gate

**Live status: BLOCKED.** Repository commits and templates are not build, migration,
deployment, rollback, restore, or mailbox-Open evidence. Keep each release record
`blocked-live` until every required value below is supplied from the approved
environment and independently reviewed.

### Exact release evidence templates

Create one secret-free `paryatech-twenty-release-evidence/v1` record per release. Every
digest is lowercase `sha256:` plus 64 hexadecimal characters; every Git commit is the
full 40-character lowercase ID. Ordered migration arrays use exact committed
command/migration IDs and use `[]`, never `none`, when empty. Compute
`migrationSetDigest` from canonical UTF-8 JSON containing, in this order,
`instanceCommandIds`, `workspaceCommandIds`, and `clickhouseMigrationIds`.

Release A:

```yaml
schema: paryatech-twenty-release-evidence/v1
release: A
status: blocked-live
sourceCommit: <40-lowercase-hex>
sourceTreeDigest: sha256:<64-lowercase-hex>
integratedCommits:
  guardedAgencyOutreach: 693b2211639942d45b1c49023c26c26f3fe9f96e
  guardedCommercialSupport: fa14d6b453456239f6f2e0a6575b91a9bd24455b
imageReference: ghcr.io/vimaksh-technologies/twenty:<release-or-SHA>@sha256:<64-lowercase-hex>
imageIndexDigest: sha256:<64-lowercase-hex>
linuxAmd64ManifestDigest: sha256:<64-lowercase-hex>
rollback:
  sourceCommit: <40-lowercase-hex>
  sourceTreeDigest: sha256:<64-lowercase-hex>
  imageReference: twentycrm/twenty@sha256:61a190e9dda07afc4d3d1b9b53fd1cd8cf23da8dfe4dd1f1176b1cbb0932106e
  imageIndexDigest: sha256:61a190e9dda07afc4d3d1b9b53fd1cd8cf23da8dfe4dd1f1176b1cbb0932106e
  linuxAmd64ManifestDigest: sha256:f82a0ffdaa21d0d0d2092e5c26d3716271d0fdff327a1f714fd6722a9e707bf2
migrationSet:
  instanceCommandIds: [<exact-ordered-command-ids>]
  workspaceCommandIds: [<exact-ordered-command-ids>]
  clickhouseMigrationIds: [<exact-ordered-migration-ids>]
  migrationSetDigest: sha256:<64-lowercase-hex>
  preUpgradeStatusEvidenceHash: sha256:<64-lowercase-hex>
  postUpgradeStatusEvidenceHash: sha256:<64-lowercase-hex>
  forwardSmokeEvidenceHash: sha256:<64-lowercase-hex>
  rollbackSmokeEvidenceHash: sha256:<64-lowercase-hex>
```

Release B:

```yaml
schema: paryatech-twenty-release-evidence/v1
release: B
status: blocked-live
sourceCommit: <40-lowercase-hex>
sourceTreeDigest: sha256:<64-lowercase-hex>
integratedCommits:
  guardedAgencyOutreach: 693b2211639942d45b1c49023c26c26f3fe9f96e
  guardedCommercialSupport: fa14d6b453456239f6f2e0a6575b91a9bd24455b
  boundedMailboxHistory: 8738e544031e9cce3d044d9a566aa9af849550c1
  messageAttachmentAuthorization: 4c72ed2eec95caa162611a224de14ff58eaa6595
imageReference: ghcr.io/vimaksh-technologies/twenty:<release-or-SHA>@sha256:<64-lowercase-hex>
imageIndexDigest: sha256:<64-lowercase-hex>
linuxAmd64ManifestDigest: sha256:<64-lowercase-hex>
rollback:
  release: A
  sourceCommit: <exact-Release-A-sourceCommit>
  sourceTreeDigest: <exact-Release-A-sourceTreeDigest>
  imageReference: <exact-Release-A-imageReference>
  imageIndexDigest: <exact-Release-A-imageIndexDigest>
  linuxAmd64ManifestDigest: <exact-Release-A-linuxAmd64ManifestDigest>
  migrationSetDigest: <exact-Release-A-migrationSetDigest>
migrationSet:
  instanceCommandIds: [<exact-ordered-command-ids>]
  workspaceCommandIds: [<exact-ordered-command-ids>]
  clickhouseMigrationIds: [<exact-ordered-migration-ids>]
  migrationSetDigest: sha256:<64-lowercase-hex>
  preUpgradeStatusEvidenceHash: sha256:<64-lowercase-hex>
  postUpgradeStatusEvidenceHash: sha256:<64-lowercase-hex>
  forwardSmokeEvidenceHash: sha256:<64-lowercase-hex>
  rollbackSmokeEvidenceHash: sha256:<64-lowercase-hex>
```

The recorded Release A `sourceCommit` must contain both Release A integration commits.
The Release B `sourceCommit` must contain all four listed U5/U6/U8 capability commits;
the build fails closed if ancestry or the clean source-tree digest differs. Release B
rollback values must byte-for-byte equal the accepted Release A record. Keep Release A
deployed and available as rollback until Release B migrations, restore, and mailbox
acceptance all pass.

### Release B deploy and mailbox opening

Run the normal upgrade sequence against the exact Release B migration arrays and
record the pre/post status and forward/rollback smoke hashes. Mailbox remains `Closed`
until one evidence bundle proves: the exact 90-day initial bound and ongoing sync;
selected customer folders and dedicated primary calendar; full message bodies and
unambiguous association; actor-authorized attachment read/download and denial;
provider deletion, folder removal, and disconnect delete the Twenty mirror and R2
object; Gmail attachment backup and isolated restore; and reconnect after restore with
fresh administrator authorization while the retired grant/token remains denied.
The named data owner's broad-visibility and provider-mirror-deletion acceptance must
reference that exact Release B image.

Any failed build, digest, migration, authorization, history, scope, access, deletion,
reconnect, backup, restore, or visibility gate keeps mailbox `Closed`, leaves Release A
as rollback, and opens or updates C08 with the last trusted state, stop owner, resume
owner, due/escalation, and scrubbed evidence hash. Resolution alone never resumes
deployment or sync; the named resume owner must explicitly resume after the failed gate
passes.
