# Twenty Dokploy deployment runbook

**Status:** pre-deployment skeleton. Complete the pre-creation gates and project
lookup before creating resources; record the remaining bracketed identifiers immediately
after creation and before deploying a workload.

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
- Never deploy a floating tag such as `latest`, `main`, or an unpinned version tag.
- Future custom releases use
  `ghcr.io/vimaksh-technologies/twenty:<immutable release-or-SHA>`. Record the release
  identifier, immutable digest, source commit, migration outcome, and deployment time
  in the change record.
- Resolve and review the image digest before every deployment. A tag is provenance
  metadata, not a deployment identifier.

## Service topology and resources

Twenty requires separate server and worker processes, PostgreSQL, and Redis. Use
Dokploy-managed services and an internal network; expose only the HTTP server through
the exact Traefik route.

| Workload | CPU ceiling | Memory ceiling | Notes |
| --- | ---: | ---: | --- |
| Twenty server | 1.25 CPU | 2 GiB | Public HTTP process; the only process allowed to execute migrations |
| Twenty worker | 0.75 CPU | 1.25 GiB | No public route; migrations and cron registration disabled |
| PostgreSQL 16 | 1 CPU | 1.5 GiB | Persistent volume; private only; health check required |
| Redis 7.4 | 0.25 CPU | 384 MiB | Private only; set eviction policy to `noeviction`; health check required |

### Health checks, sequencing, and migrations

1. Start PostgreSQL 16 and Redis 7.4 with health checks. Do not start either Twenty
   process until both dependencies are healthy; Redis must use `noeviction`.
2. Start the Twenty server next. It is the **only** process that may execute migrations;
   wait for its migration completion and application health check before starting a
   worker.
3. Configure the Twenty worker with both migrations and cron registration disabled.
   Start it only after the database/Redis health checks and server migration/health
   checks pass.
4. Run `yarn command:prod upgrade:status` in the target server-release context and
   parse its result, rather than treating command exit alone as sufficient. Fail closed:
   do not proceed when the result reports a database that is behind, a failed upgrade,
   or any ambiguous/unparseable state. Preserve only a scrubbed status summary in the
   protected change record.

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

## R2 boundaries

- Use the separate private staging/Team R2 primary bucket
  `paryatech-twenty-crm` only for Twenty's primary object storage.
- Use the separate private staging/Team R2 backup bucket
  `paryatech-twenty-crm-backups` only for backups and restore artifacts.
- Do not reuse buckets, credentials, endpoints, or policies from another application.
- Keep bucket IDs, access keys, secret keys, account identifiers, and endpoints out of
  Git, this runbook, logs, tickets, shell history, and copied Dokploy output.
- Before enablement, confirm least-privilege access, private bucket visibility,
  encryption expectations, lifecycle policy, and a successful non-production restore.

## Secrets and recovery handling

- Store runtime secrets only in the approved Dokploy secret/integration mechanism.
  Reference secret names in the change record only when they reveal no value or
  provider identifier.
- Treat database passwords, Redis credentials, application encryption keys, JWT/auth
  secrets, SMTP credentials, R2 credentials, and Cloudflare/Dokploy credentials as
  secrets. Do not echo them with `env`, `inspect`, compose exports, screenshots, or
  support bundles.
- Keep two authorized maintainers able to retrieve the recovery material through the
  approved secret manager. Document access ownership and rotation date in the protected
  change record, not here.
- A lost application encryption key or incompatible restored secret set can make data
  unrecoverable. Test recovery in an isolated environment before relying on it.

## Google Workspace and low-volume SMTP gates

The compose file accepts only the Twenty v2.27 configuration names below. The
Dokploy variable name is the secret/config reference; its value belongs in the
approved secret manager and must never be copied into Git, a change record, command
output, screenshot, or shared log.

| Dokploy variable name | Required effective configuration |
| --- | --- |
| `MESSAGING_PROVIDER_GMAIL_ENABLED` | `false` in production through Release A; enable only for an approved staging smoke or Release B mailbox opening |
| `CALENDAR_PROVIDER_GOOGLE_ENABLED` | `false` in production through Release A; enable only for an approved staging smoke or Release B calendar opening |
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

## Backup, restore, and retention

- Back up PostgreSQL with a consistent logical dump or approved database-native method
  into `paryatech-twenty-crm-backups`; include the timestamp, source release, checksum,
  and restore instructions with each artifact.
- Back up required object metadata/content according to the approved Twenty storage
  design. A database dump alone is not a complete restore when uploads are in R2.
- Define and approve backup cadence, retention periods, deletion lifecycle, ownership,
  and alerting before production data is accepted: `[backup policy and owner pending]`.
- Before upgrades, take and verify a fresh backup. Restore only into an isolated
  environment first, check the application and object references, then obtain approval
  before any recovery action against the live deployment.
- Do not use Docker volume removal, database reset, or R2 deletion as a recovery tool.

## Monitoring

- Monitor server and worker health, restart count, CPU/memory versus the ceilings,
  PostgreSQL capacity/connections, Redis availability, root-disk capacity, and host
  swap use.
- Alert on HTTP/TLS failures at `https://twenty.paryatech.in`, failed jobs, backup
  failures, certificate renewal failures, and sustained resource pressure.
- Associate dashboard, alert route, owner, and escalation path with the final Dokploy
  application in the protected operations record: `[monitoring ownership pending]`.
- Logs must be scrubbed before sharing. Never include request authorization headers,
  cookies, database URLs, R2 credentials, or secret environment values.

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
4. Deploy the pinned initial image with the four bounded services, persistent
   PostgreSQL storage, private internal connections, and the documented startup order.
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
2. Recheck host headroom, Swarm/Traefik health, exact DNS/route ownership, TLS, R2
   access, and a fresh verified backup. Stop if any gate is uncertain.
3. Test the exact image and migration path in an isolated non-production environment.
4. Run and parse `yarn command:prod upgrade:status` for the target server release. Fail
   closed for behind, failed, or ambiguous status; resolve the state before deployment.
5. Deploy the pinned image through Dokploy, keeping server/worker/database/Redis limits
   unchanged unless a separately approved capacity change exists. Preserve the required
   dependency → server migration/health → worker startup sequence.
6. Watch migration completion, server health, worker health, HTTP/TLS, and error rates.
7. Run the deployment verification checklist. If rollback criteria are met, stop the
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
- Do not expose PostgreSQL, Redis, worker, management ports, or Traefik dashboards.
- Do not paste Docker inspection output, environment dumps, tokens, backup URLs, or
  credentials into this document or issue comments.

## Deployment verification checklist

- [ ] Authenticated read-only Dokploy project lookup completed; final identifiers recorded in the protected change record.
- [ ] Authorized read-only Cloudflare zone review confirms exact/wildcard DNS ownership and no conflict.
- [ ] Dokploy exact route for `twenty.paryatech.in` is present and no duplicate route exists.
- [ ] HTTPS serves the intended Twenty deployment with a valid hostname certificate.
- [ ] Initial image is pinned to the documented v2.27.0 immutable digest, or an approved custom immutable release digest is recorded.
- [ ] Server, worker, PostgreSQL 16, and Redis 7.4 use the documented ceilings; Redis is configured with `noeviction`; only the server is publicly routed.
- [ ] PostgreSQL/Redis health checks pass, followed by server migration/health, followed by worker startup with migrations and cron registration disabled.
- [ ] `yarn command:prod upgrade:status` was parsed in the target server-release context and is neither behind, failed, nor ambiguous.
- [ ] PostgreSQL persistence and private service connectivity are verified.
- [ ] Primary and backup R2 buckets are distinct, private, least-privilege, and usable without disclosing credentials.
- [ ] Google/SMTP configuration uses only the documented Dokploy variable names; secret values are absent from Git, logs, screenshots, exports, and the change record, and no stale Server Admin override exists.
- [ ] Both exact Google callbacks and the approved seven-scope consent set pass in staging; revoke requires fresh consent and rotation invalidates the retired credential.
- [ ] Release A keeps Gmail and Calendar disabled; Release B alone may connect `team@paryatech.in` after U8, selected-folder/internal-event exclusions, both auto-creation controls, primary-calendar scope, and data-owner acceptance pass.
- [ ] SMTP remains `LOGGER` until U10; any later staging/Release A SMTP activation proves authenticated TLS, local failure, provider acceptance, bounce/reply reconciliation, redacted evidence, and no campaign/contact-count interpretation.
- [ ] `LOGIC_FUNCTION_TYPE` and `CODE_INTERPRETER_TYPE` remain `DISABLED` on server and worker.
- [ ] Fresh backup succeeds; isolated restore test has been completed against the approved retention policy.
- [ ] Temporary Traefik Basic Auth was used for bootstrap (or the explicitly authorized SSH-tunnel fallback); its credential was delivered outside Git and logs.
- [ ] Before the access gate was explicitly removed or relaxed, a non-secret test proved that unauthenticated users could not create a workspace.
- [ ] First administrator bootstrap, login, record workflow, upload workflow, and worker job all succeed.
- [ ] Monitoring, backup, TLS, and resource alerts have owners and an escalation path.
- [ ] Change record includes the deployed digest, migration result, verification result, and rollback decision.
