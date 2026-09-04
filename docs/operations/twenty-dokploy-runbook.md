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
- [ ] Fresh backup succeeds; isolated restore test has been completed against the approved retention policy.
- [ ] Temporary Traefik Basic Auth was used for bootstrap (or the explicitly authorized SSH-tunnel fallback); its credential was delivered outside Git and logs.
- [ ] Before the access gate was explicitly removed or relaxed, a non-secret test proved that unauthenticated users could not create a workspace.
- [ ] First administrator bootstrap, login, record workflow, upload workflow, and worker job all succeed.
- [ ] Monitoring, backup, TLS, and resource alerts have owners and an escalation path.
- [ ] Change record includes the deployed digest, migration result, verification result, and rollback decision.
