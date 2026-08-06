# ParyaTech Twenty Dokploy Deployment Design

**Date:** 2026-08-06  
**Status:** Approved for implementation planning  
**Target:** `https://twenty.paryatech.in`  
**Environment count:** One

## 1. Outcome

Deploy one self-hosted Twenty CRM instance for ParyaTech management and sales on the existing shared Dokploy server. The separate ParyaTech production VM is out of scope and must not be changed.

The first deployment uses upstream release `twentycrm/twenty:v2.27.0`, pinned in Compose to its resolved `sha256` digest. This avoids building the large Twenty monorepo on the shared server, prevents a mutable tag from changing the deployed artifact, and gives the team a stable baseline. The durable customization and release path remains the Vimaksh Technologies Twenty fork.

## 2. Boundaries

### In scope

- One Dokploy project dedicated to Twenty.
- One environment named `production`.
- Public URL `https://twenty.paryatech.in`.
- Twenty server and worker.
- PostgreSQL 16 and Redis.
- Persistent CRM database storage.
- Dedicated primary and backup buckets in the staging/Team Cloudflare R2 account for uploaded files.
- Off-host database and file backups.
- HTTPS, health checks, resource limits, and first-admin handoff.
- A documented path from the upstream image to Vimaksh-built images.

### Out of scope for the initial deployment

- The separate ParyaTech production VM.
- Cold-outreach providers and campaign execution.
- Google Workspace or Microsoft 365 OAuth.
- SMTP configuration beyond what is required to make the application usable.
- ParyaTech OS synchronization.
- Core Twenty modifications.
- Multiple Twenty workspaces or environments.
- Logic-function or code-interpreter execution.

## 3. Selected Topology

```text
Cloudflare DNS / TLS edge
          |
          v
twenty.paryatech.in
          |
          v
Existing shared Dokploy host
  |
  +-- Dokploy + Traefik
  |
  +-- ParyaTech Twenty project
      +-- production environment
          +-- Twenty server :3000
          +-- Twenty worker
          +-- PostgreSQL 16
          +-- Redis
          +-- persistent named volumes
          +-- staging/Team R2 object storage
```

Twenty is isolated as its own Dokploy project and Compose network, but it shares the host, Docker daemon, Dokploy control plane, CPU, memory, and disk with other staging/shared services. This is deliberate and is not equivalent to infrastructure-level production isolation.

## 4. Alternatives Considered

### A. Current shared Dokploy host — selected

Advantages:

- No additional VM or Dokploy control plane.
- Fastest path to a usable internal CRM.
- Existing Traefik, Cloudflare, deployment, and operations conventions apply.
- Suitable for the initial internal team and controlled import ramp.

Trade-offs:

- Shared resource and failure domain.
- Requires limits, disk monitoring, and cautious imports.
- Not suitable for an unbounded workload without later capacity review.

### B. Dedicated remote deployment server

Provides workload, storage, and host isolation while retaining the existing Dokploy UI. This was rejected because the separate VM is reserved for ParyaTech production workloads rather than Twenty.

### C. Separate Dokploy instance and server

Provides the strongest administrative and workload isolation. It was rejected as unnecessary for the current internal CRM stage and would add operational overhead.

## 5. Deployment Unit

Use a Dokploy Docker Compose resource based on the supported Twenty Compose topology:

- `server`: the resolved `twentycrm/twenty:v2.27.0@sha256:<digest>`
- `worker`: the same resolved `twentycrm/twenty:v2.27.0@sha256:<digest>` with `yarn worker:prod`
- `db`: `postgres:16`
- `redis`: a pinned Redis major version with `noeviction`

Only the `server` service is routed publicly. PostgreSQL and Redis must have no published host ports. The worker, database, and Redis remain internal to the Compose network.

The Compose file must use named volumes for PostgreSQL data. Local Twenty upload storage is not the production storage authority; uploaded files use Cloudflare R2 through the S3-compatible API.

## 6. Configuration and Secrets

The initial environment must include at least:

- `SERVER_URL=https://twenty.paryatech.in`
- Pinned image tag and resolved digest
- PostgreSQL database, user, and generated password
- `PG_DATABASE_URL`
- `REDIS_URL`
- A generated `ENCRYPTION_KEY`
- A separately generated `APP_SECRET` for authentication/JWT compatibility
- `STORAGE_TYPE=S_3`
- R2 account endpoint, bucket, region, access key, and secret key
- Single-workspace mode
- Database-backed admin configuration
- Production runtime mode
- Disabled logic functions and code interpreter

Secrets are stored only in Dokploy/runtime secret configuration and the protected operator secret store. They must never be committed to this repository, copied into the design or runbook, or printed into deployment logs.

The `ENCRYPTION_KEY` and `APP_SECRET` require separately stored recovery copies. `ENCRYPTION_KEY` remains the primary at-rest encryption key; `APP_SECRET` must not be used as a substitute for it. Losing the encryption key can make stored OAuth credentials, TOTP secrets, application variables, signing keys, and other encrypted data unrecoverable.

## 7. Cloudflare and R2

`twenty.paryatech.in` belongs to the HQ `paryatech.in` zone. DNS must be resolved and inspected before mutation. If the existing wildcard record already routes the hostname correctly, no redundant exact record is required. If an exact record is created, it must target the current shared Dokploy host and preserve the intended Cloudflare proxy/TLS behavior.

The user explicitly selected the staging/Team R2 account for Twenty storage. To avoid mixing CRM files with ParyaTech OS staging files:

- A dedicated private Twenty primary bucket is mandatory. Do not fall back to prefix isolation because Twenty's current storage configuration does not expose a configurable root prefix.
- Create a separate private Twenty backup bucket for timestamped file-backup snapshots.
- Do not use the staging inbound-email raw bucket.
- Do not expose the bucket publicly.
- Configure bucket CORS only for `https://twenty.paryatech.in` when browser-based object access requires it.
- Prefer a Twenty-specific bucket-scoped S3 credential over a broad account credential when Cloudflare supports creating it during rollout.
- Copy primary objects daily into timestamped backup snapshots rather than using a destructive mirror that propagates deletions.
- Apply a Cloudflare R2 Bucket Lock rule to backup snapshots after verifying that restore and retention operations remain manageable. Do not assume S3 Object Lock API compatibility; configure and verify the Cloudflare-native bucket-lock control.

This is an intentional cross-account arrangement: the hostname is in the HQ zone while object storage is in the Team R2 account. The separation must be recorded in the operations handoff.

## 8. Capacity and Resource Controls

The shared host was observed with four CPUs, approximately 15 GiB RAM, approximately 4.9 GiB available RAM, active swap use, and approximately 57 GiB free root disk before deployment.

The initial deployment therefore follows these constraints:

- Pull prebuilt images; do not build Twenty on the Dokploy host.
- Apply explicit memory and CPU limits per service.
- Keep PostgreSQL and Redis internal.
- Enable Docker image cleanup without deleting active volumes.
- Store uploads in R2 rather than growing local application storage.
- Begin with a small controlled dataset.
- Observe memory, swap, database size, queue depth, and response time before importing 10,000–50,000 agencies.

Initial service limits:

| Service | CPU limit | Memory limit |
| --- | ---: | ---: |
| Twenty server | 1.25 CPU | 2 GiB |
| Twenty worker | 0.75 CPU | 1.25 GiB |
| PostgreSQL | 1 CPU | 1.5 GiB |
| Redis | 0.25 CPU | 384 MiB |

These are ceilings, not reservations. Before import expansion, the host must sustain at least 2 GiB readily available memory, avoid sustained swap growth, remain below 75% root-disk use, and keep Twenty's representative interactive requests below a two-second p95. If those conditions fail, pause imports and move or resize the workload.

If the host cannot maintain healthy memory, disk, and latency under controlled imports, move Twenty to a dedicated remote deployment server rather than weakening safety limits.

## 9. Data and Backup Design

PostgreSQL is the CRM source of truth. Redis is disposable queue/cache infrastructure and is not treated as the authoritative backup target.

Required protection:

1. Automated logical PostgreSQL backups to an off-host R2/S3 location.
2. A separate backup of the PostgreSQL named volume where operationally useful.
3. Daily timestamped copies from the primary R2 bucket to the separate backup bucket; Cloudflare R2 currently has no general object-versioning facility that may be assumed by this design.
4. A protected recovery copy of the Twenty encryption and application secrets.
5. Daily backup verification and notifications.
6. A database and file restore test before importing the complete agency dataset.
7. A pre-upgrade database backup before every Twenty image change.

Volume-only database backups are insufficient unless the database is stopped or consistency is otherwise guaranteed. Logical `pg_dump` backups are required.

Initial target policy:

- Daily logical database backup.
- Daily timestamped R2 file backup to the dedicated backup bucket.
- At least seven daily recovery points and four weekly recovery points.
- A manual pre-change backup before upgrades or configuration migrations.
- Restore test into a temporary isolated database and temporary isolated R2 restore prefix/bucket before production data import and periodically thereafter.
- Backup success and staleness alerts through an existing Dokploy notification provider to `team@paryatech.in`. If no working provider exists, notification setup is a deployment blocker.
- A synthetic failure or stale-backup test must prove that the notification reaches the recipient.

## 10. Authentication and Initial Access

Twenty remains in single-workspace mode. The first authorized ParyaTech operator creates the workspace and becomes the administrator. Public workspace creation must remain disabled after initialization.

The initial public route must be protected by a temporary Traefik basic-auth middleware before it becomes reachable. Its generated bootstrap credential is delivered to the authorized operator outside Git and deployment logs. The deployment is not complete until that operator creates the first workspace/admin account, confirms that another unauthenticated user cannot create a workspace, and authorizes removal of the temporary middleware. If a safe temporary middleware cannot be installed, keep the public route disabled and perform bootstrap through a controlled SSH tunnel instead.

Initial password authentication is acceptable for bootstrap. Google or Microsoft SSO and mailbox/calendar integrations are configured as a separate controlled change after the base deployment is stable.

## 11. Deployment Sequence

1. Inspect current DNS, Dokploy state, host capacity, network, and existing service names.
2. Resolve `twenty.paryatech.in` and confirm the expected HQ zone before any DNS mutation.
3. Inspect the staging R2 account and choose or create an isolated Twenty storage target.
4. Create the Dokploy project and single `production` environment.
5. Generate database and encryption secrets without printing them.
6. Create the Compose resource with pinned images, health checks, internal networking, persistence, and resource limits.
7. Install environment variables and secrets.
8. Install the temporary bootstrap access gate, then configure the domain to route only to the Twenty server on port 3000.
9. Deploy and wait for PostgreSQL, Redis, migrations, server health, and worker startup.
10. Run `upgrade:status`, capture its full output, and explicitly assert that the instance and every workspace report `Up to date` with zero behind or failed entries; do not rely on command exit code alone. Fail closed on any ambiguous, behind, or failed status. Keep the worker's migration execution disabled.
11. Verify HTTPS, redirects, response headers, health endpoint, logs, database persistence, and primary R2 write/read behavior.
12. Configure logical database backups, timestamped R2 file backups, and backup-staleness notifications.
13. Test one database backup, one file backup, and the notification failure path.
14. Perform database and file restore rehearsals before bulk data import.
15. Have the authorized operator create the first workspace/admin through the protected route.
16. Verify that an unauthenticated second user cannot create another workspace, then remove the bootstrap gate.
17. Execute one harmless workflow end to end and confirm its run completes to prove worker processing rather than only process liveness.

## 12. Failure Handling

- If database migration fails, stop the worker, retain the database volume, inspect migration status, and do not recreate volumes.
- If the application image is unhealthy, preserve the database and R2 data, inspect logs, and restore the pre-change database backup if the migration changed schema incompatibly.
- If R2 is unavailable, prevent uploads from being treated as durable and alert; do not silently fall back to ephemeral container storage.
- If resource pressure affects other shared services, stop Twenty first and reassess placement or limits.
- If DNS or TLS validation is ambiguous, do not alter the wildcard or existing production resolver configuration.
- Never run `docker compose down --volumes` or delete Dokploy resources containing production CRM data as a troubleshooting step.

## 13. Verification Gates

Deployment is complete only when all of these pass:

- `https://twenty.paryatech.in` returns a valid HTTPS response.
- `/healthz` is healthy through the application and internally.
- PostgreSQL and Redis are not publicly reachable.
- Server and worker use the same immutable image version.
- Database migrations report current status.
- Restarting server and worker preserves records and uploaded files.
- A test file can be written to and retrieved from the isolated R2 location.
- A logical database backup completes off-host.
- A timestamped file backup completes into the separate R2 backup bucket.
- Database and file restore rehearsals succeed before bulk import.
- A backup-failure/staleness alert reaches `team@paryatech.in` through a working Dokploy notification provider.
- The authorized first administrator exists, unauthenticated workspace creation is closed, and the temporary bootstrap gate has been removed.
- A harmless workflow run completes successfully through the worker.
- Host memory, swap, disk, and service health remain acceptable.
- No credentials appear in Git, Compose source, deployment logs, or the design/runbook.

## 14. Future Vimaksh Fork Release Flow

The bootstrap image does not change ownership of the future product flow. Vimaksh's fork remains the customization and release source.

Preferred order of customization:

1. Twenty metadata configuration: objects, fields, views, roles, workflows.
2. Private ParyaTech Twenty App: UI, actions, objects, and integration logic supported by the SDK.
3. External integration service for provider events and ParyaTech OS synchronization.
4. Core fork changes only when the extension surfaces cannot meet an approved requirement.

When a custom fork image is needed:

```text
twentyhq upstream
      |
      v
Vimaksh Twenty fork
      |
      v
CI test + immutable Docker build
      |
      v
ghcr.io/vimaksh-technologies/twenty:<release-or-sha>
      |
      v
Dokploy production image update
```

Release rules:

- Regularly synchronize the Vimaksh fork with upstream Twenty.
- Build in CI, not on the shared Dokploy host.
- Push immutable version or commit-SHA tags to GHCR.
- Never deploy floating `latest` or a mutable branch tag.
- Test the candidate image against an isolated database copy.
- Take a production database backup before the image switch.
- Allow only the server container to run migrations; the worker keeps migrations disabled.
- Verify migration status, server health, worker queues, login, and key CRM flows after rollout.
- Treat database migrations as potentially irreversible: code rollback may require database restore.

Switching from the upstream bootstrap image to a compatible Vimaksh image does not require a CRM data migration beyond the normal Twenty schema upgrade process because both images use the same PostgreSQL and R2 stores.

## 15. Operations Handoff

The deployment handoff must record, without embedding secrets:

- Dokploy project, environment, Compose, and domain identifiers.
- Deployed image digest and tag.
- PostgreSQL and Redis service names and volume names.
- R2 account boundary, bucket/prefix, and credential owner.
- Encryption-key recovery location owner.
- Backup schedules, retention, last success, and restore instructions.
- DNS record and TLS resolver path.
- Resource limits and observed post-deployment usage.
- Upgrade and emergency-stop procedures.
- First administrator and operational owners.
