# Paryatech CRM workspace runbook

**Status:** U1–U3 manual-configuration contract. This document defines reproducible
metadata, identity, permission, and native operating-surface recipes; it does not
authorize or record a live production change.

## Scope and safety boundary

- Target one internal Paryatech workspace on Twenty v2.27.
- Configure metadata first in a disposable workspace. Do not configure production
  from this document alone.
- Company remains Agency, Person remains Agency Contact, Opportunity remains one
  pursuit, and Task and Note remain the accountable activity primitives.
- Do not create parallel Agency, Contact, Opportunity, Task, or Note objects.
- Do not enter secrets, credentials, source rows, message bodies, attachments,
  payment instruments, bank or UPI data, identity documents, or real PII while
  recreating or verifying this recipe.
- U1 creates metadata and records policy decisions. U2 defines identities, roles,
  protected fields, recovery, and verification. U3 defines native views, dashboards,
  Tasks, Notes, reminders, and daily procedures. Import is U4; guarded mutations are
  U5/U6; mailbox synchronization is U8.

## Naming and requiredness conventions

| Marker | Meaning |
| --- | --- |
| **Create** | Required when the record is first created. |
| **Transition** | Required by the guarded U5/U6 action before the named state change. |
| **Policy** | Required in the singleton CRM Operating Policy before the dependent gate. |
| **Optional** | May remain empty without changing a lifecycle or metric. |
| **System** | Written only by import, a guarded action, or approved administrator recovery. |
| **Protected** | Direct operator editing must be denied in U2; U5/U6 owns mutation. |

Internal names below are the canonical API names. Labels may use the friendly label
shown, but internal names, types, relation targets, cardinality, and select values
must not drift.

## Object inventory

| ID | Internal name | Label | Kind | Display field | Creation rule |
| --- | --- | --- | --- | --- | --- |
| N01 | `company` | Agency | Native Company | `name` | Re-label; do not duplicate. |
| N02 | `person` | Agency Contact | Native Person | `name` | Re-label; do not duplicate. |
| N03 | `opportunity` | Opportunity | Native Opportunity | `name` | One record per pursuit. |
| N04 | `task` | Task | Native Task | `title` | Keep native. |
| N05 | `note` | Note | Native Note | `title` | Keep native. |
| C01 | `acquisitionSource` | Acquisition Source | Custom | `name` | Create. |
| C02 | `acquisitionEvent` | Acquisition Event | Custom | `name` | Create after C01. |
| C03 | `product` | Product | Custom | `name` | Create. |
| C04 | `commercialAgreement` | Commercial Agreement | Custom | `agreementReference` | Create after C03. |
| C05 | `supportCase` | Support Case | Custom | `caseReference` | Create. |
| C06 | `supportReceipt` | Support Receipt | Custom | `receiptKey` | Create after C05. |
| C07 | `outreachEvent` | Outreach Event | Custom | `eventReference` | Create. |
| C08 | `sharedException` | Shared Exception | Custom | `exceptionReference` | Create. |
| C09 | `crmOperatingPolicy` | CRM Operating Policy | Custom singleton | `name` | Exactly one active record. |

Record the generated object metadata ID and universal identifier after disposable
recreation and again after approved production creation. Until then the execution
record is **not configured**; never invent identifiers.

## Fixed select vocabularies

### Lifecycle and operating state

| Select | Exact ordered values |
| --- | --- |
| Agency lifecycle | `Imported / Uncontacted`; `Active Prospect`; `Customer` |
| Agency disposition | `Eligible`; `Nurture`; `Not a Fit`; `Suppressed` |
| Reservation status | `Claimed`; `Released`; `Expired` |
| Contact status | `Active`; `Inactive`; `Left Agency`; `Unknown` |
| Preferred channel | `Email`; `Phone`; `Official WhatsApp`; `Personal WhatsApp Exception`; `Other` |
| Outreach outcome | `Attempted`; `Provider Accepted / Completed Call`; `Pending / Unknown`; `Contacted`; `Engaged`; `Failed`; `Bounced` |
| Opportunity stage | `Qualified`; `Demo Scheduled`; `Demo Completed`; `Proposal / Commercial Decision`; `Negotiation`; `Awaiting Payment`; `Paid / Won`; `Lost` |
| Trial substate | `Approved`; `Active`; `Completed`; `Expired`; `Cancelled` |
| Payment state | `Pending`; `Part-paid`; `Paid`; `Overdue`; `Waived`; `Refunded`; `Reversed` |
| Renewal state | `Renewing`; `Renewed`; `Changed`; `Not Renewing`; `Lapsed` |
| Activation state | `Pending`; `Confirmed`; `Review Required` |
| Adoption state | `Not Assessed`; `Evidence Tracking`; `Milestone Recorded` |
| Support status | `New`; `Assigned`; `In Progress`; `Waiting on Agency`; `Waiting Internal`; `Resolved`; `Closed` |
| Support priority | `Urgent`; `High`; `Normal`; `Low` |
| Support disposition | `Support`; `Duplicate`; `Non-support`; `Resolved`; `Withdrawn` |
| Exception status | `New`; `Investigating`; `Blocked`; `Resolved`; `Reopened` |
| Evidence reconciliation | `Current`; `Stale`; `Conflict` |

`Nurture` is only an Agency disposition after a Lost Opportunity. It is never an
Opportunity stage. Trial is an optional substate after Demo Completed and is never a
stage or an Agency-size default.

### Business classification

| Select | Exact ordered values |
| --- | --- |
| Team-size band | `Solo`; `2–5`; `6–10`; `11–25`; `26–50`; `51+`; `Unknown` |
| Specialization | `Domestic Leisure`; `International Leisure`; `Corporate Travel`; `MICE / Groups`; `Religious / Pilgrimage`; `Adventure`; `Education`; `Medical`; `Transport / Ticketing Only`; `Other`; `Unclassified` |
| Acquisition cohort | `Community`; `Exhibition`; `Referral`; `Inbound`; `Advertising`; `Partner`; `Other`; `Unclassified` |
| Affiliation | `None Stated`; `Named Association`; `Other`; `Unclassified` |
| Current tool | `None Stated`; `Spreadsheet`; `WhatsApp`; `Email`; `Consumer OTA`; `B2B Portal`; `GDS`; `CRM`; `Accounting Tool`; `Other`; `Unclassified` |
| Buying/operating role | `Owner / Founder`; `Decision Maker`; `Commercial`; `Sales`; `Operations`; `Support`; `Finance`; `Influencer`; `Unknown` |
| Loss reason | `No Need`; `No Budget`; `No Authority`; `Timing`; `Competitor`; `Product Gap`; `Unresponsive`; `Duplicate Pursuit`; `Compliance / Suppression`; `Other` |
| Source type | `Community`; `Exhibition`; `Referral`; `Inbound`; `Advertising`; `Partner`; `Other` |
| Product family | `ParyatechOS`; `Itinerary Builder`; `Bundle`; `Other` |
| Eligible term | `Quarterly`; `Half-yearly`; `Yearly` |
| Support channel | `Email`; `Phone`; `Official WhatsApp`; `Personal WhatsApp`; `Manual Report`; `Other` |
| Exception capability | `Import`; `Outreach`; `Mailbox`; `SMTP`; `Sales`; `Commercial`; `Support`; `Audit`; `Security`; `Recovery`; `Integration`; `Policy` |

Use `Unclassified` rather than guessing. Promoting a source value into a controlled
classification requires a recorded data-owner decision; the original source value
remains in provenance.

## Native object field inventory

### N01 Company relabelled Agency

| Internal name | Label | Type | Requiredness | Rules |
| --- | --- | --- | --- | --- |
| `name` | Agency Name | Text | Create | Canonical display name; not an identity match by itself. |
| `agencyExternalKey` | Agency External Key | Text, unique | Create/System | Stable idempotency key; never reuse. |
| `registeredName` | Registered Name | Text | Optional | Legal/registered name when approved. |
| `website` | Website | Link | Optional | Normalized host; retain original through provenance. |
| `primaryDomain` | Primary Domain | Text | Optional | Candidate signal only. |
| `geography` | Geography | Address | Optional | City, state, postcode, country; preserve source representation in provenance. |
| `teamSizeBand` | Team Size Band | Select | Optional | Fixed vocabulary. |
| `specializations` | Specializations | Multi-select | Optional | Fixed vocabulary. |
| `acquisitionCohorts` | Acquisition Cohorts | Multi-select | Optional | Fixed vocabulary. |
| `affiliations` | Affiliations | Multi-select | Optional | Fixed vocabulary. |
| `namedAffiliations` | Named Affiliations | Text | Optional | Required when `Named Association` is selected. |
| `currentTools` | Current Tools | Multi-select | Optional | Fixed vocabulary. |
| `icpEvidence` | ICP Evidence | Long text | Optional | Human evidence; no automated score. |
| `agencyLifecycle` | Agency Lifecycle | Select | Create/Protected | Import starts `Imported / Uncontacted`. |
| `agencyDisposition` | Agency Disposition | Select | Create/Protected | Default `Eligible`; suppression changes it to `Suppressed`. |
| `originalAcquisitionSource` | Original Acquisition Source | Relation → C01 | Optional/System | Never overwritten by later influence. |
| `recordOwner` | Durable Owner | Relation → Workspace Member | System/Protected | Empty until first qualifying Contacted evidence. |
| `paryatechOsOrganizationReference` | ParyatechOS Organization Reference | Text, unique when present | Optional | Identifier only; no entitlement payload. |
| `isSuppressed` | Suppressed | Boolean | Create/Protected | Default false; outbound checks Agency and Contact. |
| `suppressionReason` | Suppression Reason | Long text | Transition/Protected | Minimum retained evidence, no unnecessary content. |
| `suppressedAt` | Suppressed At | Date-time | System/Protected | Set immediately. |
| `suppressionClearedAt` | Suppression Cleared At | Date-time | System/Protected | Legal/compliance action only. |
| `suppressionClearanceReason` | Suppression Clearance Reason | Long text | Transition/Protected | Required to clear. |
| `reservationStatus` | Reservation Status | Select | System/Protected | Empty until first claim. |
| `reservationClaimant` | Reservation Claimant | Relation → Workspace Member | System/Protected | One visible claimant. |
| `reservationClaimedAt` | Reservation Claimed At | Date-time | System/Protected | Guarded action. |
| `reservationExpiresAt` | Reservation Expires At | Date-time | System/Protected | Calculated from policy. |
| `reservationReleaseReason` | Reservation Release Reason | Long text | Transition/Protected | Required for release/transfer. |
| `firstAttemptedAt` | First Attempted At | Date-time | System/Protected | First qualifying Outreach Event only. |
| `firstProviderAcceptedAt` | First Provider Accepted At | Date-time | System/Protected | Does not imply Contacted. |
| `firstPendingUnknownAt` | First Pending / Unknown At | Date-time | System/Protected | Does not imply Contacted. |
| `firstContactedAt` | First Contacted At | Date-time | System/Protected | Headline metric timestamp, set once. |
| `firstEngagedAt` | First Engaged At | Date-time | System/Protected | Set once from two-way evidence. |

### N02 Person relabelled Agency Contact

| Internal name | Label | Type | Requiredness | Rules |
| --- | --- | --- | --- | --- |
| `name` | Contact Name | Full name | Create | Synthetic verification uses fictitious values only. |
| `personExternalKey` | Contact External Key | Text, unique | Create/System | Stable idempotency key. |
| `company` | Agency | Relation → N01 | Create | Resolve Company before Person. |
| `jobTitle` | Designation | Text | Optional | Preserve source title. |
| `emails` | Emails | Emails | Optional | Matching signal; not automatic merge proof. |
| `phones` | Phones | Phones | Optional | Preserve leading zeros and country code. |
| `profileLink` | Relevant Profile | Link | Optional | Business-relevant link only. |
| `contactRole` | Buying / Operating Role | Select | Optional | Fixed vocabulary. |
| `preferredChannel` | Preferred Channel | Select | Optional | Official WhatsApp preferred where applicable. |
| `contactStatus` | Contact Status | Select | Create | Default `Unknown`. |
| `isSuppressed` | Suppressed | Boolean | Create/Protected | Default false; blocks outbound even if Agency is clear. |
| `suppressionReason` | Suppression Reason | Long text | Transition/Protected | Minimum evidence. |
| `suppressedAt` | Suppressed At | Date-time | System/Protected | Immediate. |
| `suppressionClearedAt` | Suppression Cleared At | Date-time | System/Protected | Legal/compliance action only. |
| `suppressionClearanceReason` | Suppression Clearance Reason | Long text | Transition/Protected | Required to clear. |

### N03 Opportunity

| Internal name | Label | Type | Requiredness | Rules |
| --- | --- | --- | --- | --- |
| `name` | Opportunity Name | Text | Create | One pursuit. |
| `opportunityExternalKey` | Opportunity External Key | Text, unique | Create/System | Stable idempotency key. |
| `company` | Agency | Relation → N01 | Create | Canonical Agency. |
| `contacts` | Participating Contacts | Many relation → N02 | Transition | Required before Demo Scheduled. |
| `owner` | Opportunity Owner | Relation → Workspace Member | Create | Accountable owner. |
| `products` | Product / Bundle Interest | Many relation → C03 | Transition | Required for demo completion onward. |
| `stage` | Stage | Select | Create/Protected | Exhaustive fixed Opportunity stages. |
| `amount` | Pursuit Value | Currency | Optional/Protected | Expected value, not booked revenue. |
| `nextAction` | Next Action | Text | Transition | Required where matrix names it. |
| `nextActionAt` | Next Action Date | Date-time | Transition | Dated next action. |
| `demoScheduledAt` | Demo Scheduled At | Date-time | Transition | Required for Demo Scheduled. |
| `demoOccurredAt` | Demo Occurred At | Date-time | Transition | Required for Demo Completed. |
| `demoAttendees` | Demo Attendees | Many relation → N02 | Transition | Required for Demo Completed. |
| `demoOutcome` | Demo Outcome | Long text | Transition | Evidence before proposal/trial. |
| `proposalDeliveredAt` | Proposal Delivered At | Date-time | Transition | Proposal evidence. |
| `commercialDecisionContext` | Commercial Decision Context | Long text | Transition/Protected | Restricted in U2. |
| `lossReason` | Loss Reason | Select | Transition | Required for Lost. |
| `lossDecisionAt` | Loss Decision At | Date-time | Transition | Required for Lost. |
| `revisitAt` | Revisit At | Date-time | Transition | Required when future follow-up intended. |
| `primarySource` | Primary Source | Relation → C01/C02 | Transition | Exactly one when an Agreement is produced. |
| `influencedSources` | Influenced Sources | Many relation → C01/C02 | Optional | Non-additive. |
| `trialState` | Trial State | Select | Protected | Empty unless approved after Demo Completed. |
| `trialReason` | Trial Reason | Long text | Transition/Protected | Required for trial approval. |
| `trialOwner` | Trial Owner | Relation → Workspace Member | Transition/Protected | Required. |
| `trialStartsAt` | Trial Starts At | Date-time | Transition/Protected | Required. |
| `trialEndsAt` | Trial Ends At | Date-time | Transition/Protected | No default duration. |
| `trialSuccessCriteria` | Trial Success Criteria | Long text | Transition/Protected | Required. |
| `trialExpectedDecision` | Trial Expected Decision | Long text | Transition/Protected | Required. |
| `trialExtensionReason` | Trial Extension Reason | Long text | Transition/Protected | Required only for extension. |
| `trialOutcome` | Trial Outcome | Long text | Transition/Protected | Required to leave trial. |
| `agreement` | Commercial Agreement | Relation → C04 | Transition/Protected | Required for Awaiting Payment/Paid Won. |

### N04 Task and N05 Note usage

| Native object | Required use | Prohibited use |
| --- | --- | --- |
| Task | Owner, due time, status, and relation to the Agency, Opportunity, Agreement, Case, or Exception that requires action. | Do not use a Task as a lifecycle, payment, support receipt, or audit record. |
| Note | Human context related to the relevant record, with commercial notes restricted in U2. | No secrets, payment instruments, unnecessary PII, raw source rows, or copied mailbox archives. |

## Custom object field inventory

### C01 Acquisition Source

| Internal name | Type | Requiredness | Rules |
| --- | --- | --- | --- |
| `name` | Text | Create | Stable source name. |
| `sourceExternalKey` | Text, unique | Create/System | Idempotency key. |
| `sourceType` | Select | Create | Fixed source type. |
| `outreachBasis` | Long text | Create/Protected | Approved business basis; not a legal conclusion. |
| `sourceBatch` | Text | Create | Batch identity. |
| `cost` | Currency | Optional/Protected | Cost remains with source. |
| `costEvidence` | Long text | Transition/Protected | Evidence reference only. |
| `owner` | Relation → Workspace Member | Create | Source-supply owner. |
| `active` | Boolean | Create | Default true. |

### C02 Acquisition Event

| Internal name | Type | Requiredness | Rules |
| --- | --- | --- | --- |
| `name` | Text | Create | Event/context label. |
| `eventExternalKey` | Text, unique | Create/System | Idempotency key. |
| `source` | Relation → C01 | Create | Parent source. |
| `eventAt` | Date-time | Create | Source event time. |
| `location` | Text | Optional | No attendee PII. |
| `boothAndTeam` | Long text | Optional | Booth/team context. |
| `sourceBatch` | Text | Create | Provenance batch. |
| `cost` | Currency | Optional/Protected | Event cost. |

### C03 Product

| Internal name | Type | Requiredness | Rules |
| --- | --- | --- | --- |
| `name` | Text | Create | Offering name. |
| `productExternalKey` | Text, unique | Create/System | Stable key. |
| `productFamily` | Select | Create | Fixed family. |
| `active` | Boolean | Create | Default true. |
| `referencePrice` | Currency | Optional/Protected | Reference, not Agreement price. |
| `eligibleTerms` | Multi-select | Create | Quarterly, Half-yearly, Yearly as approved. |
| `bundleMembers` | Many relation → C03 | Optional | Only approved bundle groupings. |
| `approvedTerms` | Long text | Optional/Protected | Approved terms reference. |

### C04 Commercial Agreement

| Internal name | Type | Requiredness | Rules |
| --- | --- | --- | --- |
| `agreementReference` | Text, unique | Create/System | Display/idempotency key. |
| `agency` | Relation → N01 | Create | Required. |
| `sourceOpportunity` | Relation → N03, unique | Create | One producing pursuit. |
| `products` | Many relation → C03 | Create | Product/bundle. |
| `term` | Select | Create/Protected | Quarterly, Half-yearly, or Yearly. |
| `startsAt` | Date | Create/Protected | Agreement term. |
| `endsAt` | Date | Create/Protected | Agreement term. |
| `grossBooked` | Currency | Create/Protected | Agreed amount before waiver/refund/reversal. |
| `currency` | Select | Create/Protected | `INR` unless approved otherwise. |
| `commercialException` | Long text | Optional/Protected | Discount/exception reason and approver. |
| `paymentState` | Select | Create/Protected | Fixed payment state. |
| `amountCollected` | Currency | Transition/Protected | Verified collected value. |
| `waivedAmount` | Currency | Transition/Protected | Authorized waived amount. |
| `refundedOrReversedAmount` | Currency | Transition/Protected | Verified returned/reversed amount. |
| `netCollected` | Currency | System/Protected | Collected minus refunded/reversed. |
| `evidenceSource` | Text | Transition/Protected | Approved evidence reference, never instrument data. |
| `evidenceType` | Text | Transition/Protected | Approved evidence type. |
| `evidenceVerifier` | Relation → Workspace Member | Transition/Protected | Required for state changes. |
| `evidenceObservedAt` | Date-time | Transition/Protected | Source observation time. |
| `evidenceRecordedAt` | Date-time | System/Protected | CRM record time. |
| `evidenceState` | Select | Transition/Protected | Current, Stale, Conflict. |
| `renewalState` | Select | Transition/Protected | Fixed renewal state. |
| `renewalAt` | Date | Create/Protected | Obligation date. |
| `renewalOwner` | Relation → Workspace Member | Create/Protected | Accountable owner. |
| `renewalNextAction` | Text | Transition/Protected | Dated with `renewalNextActionAt`. |
| `renewalNextActionAt` | Date-time | Transition/Protected | Required for active renewal. |
| `activationState` | Select | Create/Protected | Default Pending. |
| `activationConfirmedAt` | Date-time | Transition/Protected | Manual ParyatechOS confirmation. |
| `activationConfirmer` | Relation → Workspace Member | Transition/Protected | Required for Confirmed. |
| `adoptionState` | Select | Create/Protected | Default Not Assessed. |
| `adoptionEvidence` | Long text | Transition/Protected | Observed evidence only. |
| `adoptionObservedAt` | Date-time | Transition/Protected | Evidence time. |
| `restrictedNotes` | Long text | Optional/Protected | Commercial-sensitive only. |
| `paryatechOsCommercialReference` | Text, unique when present | Optional/Protected | Cutover source ID only. |

### C05 Support Case and C06 Support Receipt

| Object | Internal name | Type | Requiredness | Rules |
| --- | --- | --- | --- | --- |
| C05 | `caseReference` | Text, unique | Create/System | Stable display key. |
| C05 | `subject` | Text | Create | Concise issue. |
| C05 | `summary` | Long text | Create | Minimized support context. |
| C05 | `channel` | Select | Create | Fixed support channel. |
| C05 | `priority` | Select | Create | Urgent, High, Normal, Low. |
| C05 | `sourceReceivedAt` | Date-time | Create/Protected | Starts response clock. |
| C05 | `responseTargetAt` | Date-time | System/Protected | Business-calendar calculation. |
| C05 | `owner` | Relation → Workspace Member | Create | Immediate owner. |
| C05 | `status` | Select | Create/Protected | Fixed support status. |
| C05 | `escalation` | Long text | Optional/Protected | Escalation owner/reason. |
| C05 | `disposition` | Select | Transition/Protected | Preserves duplicate/non-support. |
| C05 | `firstSubstantiveResponseAt` | Date-time | System/Protected | Acknowledgement does not set it. |
| C05 | `resolution` | Long text | Transition/Protected | Required for Resolved/Closed. |
| C05 | `agency` | Relation → N01 | Optional | May remain unknown. |
| C05 | `contact` | Relation → N02 | Optional | May remain unknown. |
| C05 | `product` | Relation → C03 | Optional | May remain unknown. |
| C05 | `agreement` | Relation → C04 | Optional/Protected | May remain unknown. |
| C06 | `receiptKey` | Text, unique | Create/System | `channel:provider-or-source-id`; replay-safe. |
| C06 | `channel` | Select | Create/System | Observable source channel. |
| C06 | `providerOrSourceId` | Text | Create/System | Source identifier, not secret. |
| C06 | `sourceReceivedAt` | Date-time | Create/System | Immutable source time. |
| C06 | `payloadHash` | Text | Create/System | Integrity/dedupe hash; no body. |
| C06 | `case` | Relation → C05 | Create/System | Attach first or create Case immediately. |
| C06 | `receiptDisposition` | Select | Transition/Protected | Support, Duplicate, Non-support. |

### C07 Outreach Event

| Internal name | Type | Requiredness | Rules |
| --- | --- | --- | --- |
| `eventReference` | Text, unique | Create/System | Idempotency key. |
| `agency` | Relation → N01 | Create | Metric grain is unique Agency. |
| `contact` | Relation → N02 | Optional | Selected Contact. |
| `operator` | Relation → Workspace Member | Create/System | Acting user. |
| `channel` | Select | Create | Preferred-channel vocabulary. |
| `initiatedAt` | Date-time | Create/System | Attempt time. |
| `outcome` | Select | Create/Protected | Fixed outreach outcomes. |
| `providerEvidenceKey` | Text, unique when present | Optional/System | Dedupes provider evidence. |
| `providerObservedAt` | Date-time | Optional/System | Evidence time. |
| `evidenceSummary` | Long text | Transition/Protected | Minimal approved evidence. |
| `nextAction` | Text | Optional | Visible follow-up. |
| `nextActionAt` | Date-time | Optional | Dated follow-up. |
| `pendingExpiresAt` | Date-time | System/Protected | At most two business days. |
| `reasonedRetry` | Long text | Transition/Protected | Required only after pending expiry. |
| `reservationSnapshot` | Long text | System/Protected | Claimant/status/time references only. |

### C08 Shared Exception

| Internal name | Type | Requiredness | Rules |
| --- | --- | --- | --- |
| `exceptionReference` | Text, unique | Create/System | Stable key. |
| `capability` | Select | Create | Fixed capability list. |
| `affectedObject` | Text | Create | Object internal name. |
| `affectedRecordId` | Text | Create | Record ID only. |
| `status` | Select | Create/Protected | Fixed exception lifecycle. |
| `lastTrustedState` | Long text | Create/Protected | State before failure. |
| `owner` | Relation → Workspace Member | Create | Accountable owner. |
| `dueAt` | Date-time | Optional | Due or escalation required. |
| `escalation` | Long text | Optional | Escalation path. |
| `evidence` | Long text | Transition/Protected | Resolution evidence. |
| `resolvedAt` | Date-time | System/Protected | Does not resume work by itself. |
| `resumeReason` | Long text | Transition/Protected | Required explicit resume after gate pass. |
| `resumedAt` | Date-time | System/Protected | Explicit action time. |

### C09 CRM Operating Policy singleton

| Internal name | Type | Requiredness | Rules |
| --- | --- | --- | --- |
| `name` | Text, unique | Create | Exact value `Paryatech CRM Operating Policy`. |
| `active` | Boolean | Create | Exactly one active record. |
| `policyVersion` | Text, unique | Create | Immutable version label. |
| `effectiveAt` | Date-time | Create | Approval time. |
| `businessCalendar` | Long text | Policy | Timezone, workdays, hours, holidays. |
| `reservationIntervalMinutes` | Number | Policy | Positive integer; no implicit default. |
| `pendingUnknownMaxBusinessDays` | Number | Policy | Exact value `2`. |
| `pilotThresholds` | Long text | Policy | Approved omission/latency/duplicate/adherence/time thresholds. |
| `pilotBatchReference` | Text | Policy | Approved batch ID, not source content. |
| `sourceYieldAndReplenishmentPlan` | Long text | Policy | Quantified 333/1,000 supply plan. |
| `capacityInputs` | Long text | Policy | Available time and observed Agency/Case effort. |
| `roleHolderReferences` | Long text | Policy | Role names/account IDs only; no credentials. |
| `trackerInventory` | Long text | Policy | Tracker, owner, purpose, retirement gate. |
| `legalApprovalReference` | Text | Policy | Approval record reference. |
| `dataOwnerApprovalReference` | Text | Policy | Approval record reference. |
| `providerMirrorRetentionAccepted` | Boolean | Policy | Must be true before U8. |
| `providerMirrorAcceptedBy` | Relation → Workspace Member | Policy | Named data owner. |
| `providerMirrorAcceptedAt` | Date-time | Policy | Approval time. |
| `providerMirrorAcceptanceEvidence` | Long text | Policy | States provider deletion/folder removal/disconnection deletes Twenty copy. |
| `sourceStagingRetentionDays` | Number | Policy | Approved positive integer. |
| `livePiiRetentionDays` | Number | Policy | Approved positive integer or documented legal hold. |
| `suppressionEvidenceRetentionDays` | Number | Policy | Narrow minimum evidence period. |
| `exportRetentionDays` | Number | Policy | Approved positive integer. |
| `backupRetentionDays` | Number | Policy | Approved positive integer. |
| `auditRetentionDays` | Number | Policy | Approved investigation period. |
| `attachmentMirrorRetentionRule` | Text | Policy | Exact value `Provider mirror; delete on provider deletion, folder removal, or disconnect`. |
| `commercialTargetFormula` | Long text | Policy | Approved Day-0 formula. |
| `commercialEvidentiaryFloor` | Long text | Policy | Approved evidence floor. |
| `commercialTargetOwner` | Relation → Workspace Member | Policy | Accountable owner. |
| `day30TargetLockAt` | Date-time | Policy | Approved lock time. |
| `sourceSupplyOwner` | Relation → Workspace Member | Policy | Named. |
| `capacityOwner` | Relation → Workspace Member | Policy | Named. |
| `legalComplianceOwner` | Relation → Workspace Member | Policy | Suppression-clearance owner. |
| `auditReviewer` | Relation → Workspace Member | Policy | Separately accountable. |
| `recoveryAdministrators` | Many relation → Workspace Member | Policy | Exactly two before restricted rollout. |

If `providerMirrorRetentionAccepted` is false or absent, stop before U8 and request a
Product Contract revision. Independent archival retention is not an implementation
option in this runbook.

## Relation inventory

| ID | Source field | Target | Cardinality / inverse |
| --- | --- | --- | --- |
| REL01 | N02 `company` | N01 | Many Contacts → one Agency / `contacts` |
| REL02 | N03 `company` | N01 | Many Opportunities → one Agency / `opportunities` |
| REL03 | N03 `contacts` | N02 | Many ↔ many / `opportunities` |
| REL04 | N01 `originalAcquisitionSource` | C01 | Many Agencies → one Source / `originalAgencies` |
| REL05 | C02 `source` | C01 | Many Events → one Source / `events` |
| REL06 | N03 `products` | C03 | Many ↔ many / `opportunities` |
| REL07 | N03 `primarySource` | C01/C02 | Many Opportunities → one approved Source or Event / `primaryOpportunities` |
| REL08 | N03 `influencedSources` | C01/C02 | Many ↔ many / `influencedOpportunities` |
| REL09 | C04 `agency` | N01 | Many Agreements → one Agency / `agreements` |
| REL10 | C04 `sourceOpportunity` | N03 | One ↔ one / `agreement` |
| REL11 | C04 `products` | C03 | Many ↔ many / `agreements` |
| REL12 | C05 `agency` | N01 | Many Cases → zero/one Agency / `supportCases` |
| REL13 | C05 `contact` | N02 | Many Cases → zero/one Contact / `supportCases` |
| REL14 | C05 `product` | C03 | Many Cases → zero/one Product / `supportCases` |
| REL15 | C05 `agreement` | C04 | Many Cases → zero/one Agreement / `supportCases` |
| REL16 | C06 `case` | C05 | Many Receipts → one Case / `receipts` |
| REL17 | C07 `agency` | N01 | Many Outreach Events → one Agency / `outreachEvents` |
| REL18 | C07 `contact` | N02 | Many Outreach Events → zero/one Contact / `outreachEvents` |
| REL19 | Native Task/Note relations | N01/N03/C04/C05/C08 | Many activities → one relevant record per relation |

Workspace Member relations named in field tables use the native Workspace Member
object and do not create a custom user object.

## Constraints and invariants

1. Unique keys: every `*ExternalKey`, `agreementReference`, `caseReference`,
   `receiptKey`, `eventReference`, `exceptionReference`, and `policyVersion`.
2. Exactly one active C09 policy; exactly two recovery administrators before
   restricted rollout.
3. Import creates no Opportunity, reservation, durable owner, or Outreach Event.
4. First Contacted and durable owner are write-once except an audited administrator
   correction through U5.
5. Agency or Contact suppression blocks outbound. Only the named legal/compliance
   owner may clear it with evidence and reason.
6. Primary Source is exactly one before an Opportunity produces an Agreement;
   Influenced Sources are non-additive.
7. Pending, Part-paid, and Overdue cannot produce Paid / Won. Paid or authorized
   Waived can. Refunded/Reversed preserve historical win and open review.
8. Case associations may be null, but every observable Support Receipt immediately
   attaches to a verified open Case or creates an owned Case at source time.
9. Only a substantive human response sets `firstSubstantiveResponseAt`.
10. Exception resolution does not resume work; `resumeReason` and explicit guarded
    resume are required.
11. Reservation expiry is the only automatic state mutation at launch.
12. Provider deletion, folder removal, or disconnection removes the mirrored message,
    Attachment relation, and stored attachment copy after U8.

## Operating policy approval gate

Before any live import, the active C09 policy must contain:

- business calendar and timezone;
- reservation interval;
- two-business-day Pending / Unknown maximum;
- pilot batch and quantitative pilot thresholds;
- source-yield/replenishment plan for 333 and 1,000 Contacted Agencies;
- capacity inputs and source/capacity owners;
- role-holder references, exactly two recovery administrators, legal/compliance
  owner, data owner, commercial owner, and audit reviewer;
- tracker inventory and retirement gates;
- legal and data-owner approval references;
- all staging, live PII, suppression evidence, export, backup, audit, and attachment
  mirror retention entries;
- explicit provider-mirror acceptance; and
- commercial target formula, evidentiary floor, owner, and Day-30 lock time.

A missing policy value blocks only its dependent capability unless recovery,
restricted exposure, or reconstructability is affected. Missing provider-mirror
acceptance always blocks U8.

## U2 identity and permission contract

Configure and prove these controls in a disposable Twenty v2.27 workspace before any
restricted data is admitted. Role profiles are complete profiles, not additive
fragments. A person with several responsibilities receives the least-privileged
profile that permits daily work; separately accountable approvals remain assigned to
another named identity. Do not assign the system Administrator role for convenience.

### Twenty v2.27 capability model

Use the capability names below exactly. The v2.27 record-permission model exposes
`canReadObjectRecords`, `canUpdateObjectRecords`,
`canSoftDeleteObjectRecords`, and `canDestroyObjectRecords`. It has no separate
create-record bit: an object update grant is also the role's record-creation
capability, so protected creation and transitions must use the U5/U6 guarded actions.
At field level, `canReadFieldValue: false` hides a field and implies
`canUpdateFieldValue: false`; `canUpdateFieldValue: false` preserves read-only
visibility.

The actual `PermissionFlagType` values in the pinned source are:

| Category | Exact flags |
| --- | --- |
| Settings | `API_KEYS_AND_WEBHOOKS`, `WORKSPACE`, `WORKSPACE_MEMBERS`, `ROLES`, `DATA_MODEL`, `SECURITY`, `WORKFLOWS`, `IMPERSONATE`, `SSO_BYPASS`, `APPLICATIONS`, `MARKETPLACE_APPS`, `LAYOUTS`, `BILLING`, `AI_SETTINGS` |
| Tools | `AI`, `VIEWS`, `UPLOAD_FILE`, `DOWNLOAD_FILE`, `SEND_EMAIL_TOOL`, `CREATE_CALENDAR_EVENT_TOOL`, `HTTP_REQUEST_TOOL`, `CODE_INTERPRETER_TOOL`, `IMPORT_CSV`, `EXPORT_CSV`, `CONNECTED_ACCOUNTS`, `PROFILE_INFORMATION` |

The built-in Administrator role is system-managed and cannot be narrowed like a
custom role. Its power is controlled by assigning it only to the two protected
recovery identities, requiring separate authorization for high-risk use, and auditing
every use. `HTTP_REQUEST_TOOL`, `CODE_INTERPRETER_TOOL`, logic-function execution,
and production AI execution remain globally disabled even if an Administrator screen
shows the corresponding role flag.

### Human role and identity matrix

| ID | Twenty role | Identity contract | Purpose and hard boundary |
| --- | --- | --- | --- |
| ROLE-OP | `Paryatech Operator` custom role | One named human per account | Shared Agency, Contact, Opportunity, Task, Note, communication, Outreach Event, and Support Case work. No commercial-sensitive, export, delete/destroy, settings, connection, role, workflow, object-model, or key-management power. |
| ROLE-CS | `Paryatech Commercial Sensitive` custom role | One named approved human per account | Complete Operator profile plus restricted commercial read and guarded commercial actions. Still no export, delete/destroy, settings, connection, role, workflow, object-model, or key-management power. |
| ROLE-LC | `Paryatech Legal Compliance` custom role | One named accountable human per account | Review outreach basis, suppression evidence, and retained minimum evidence; only role authorized for `clearSuppression`. No outbound, opportunity, commercial, bulk-export, destructive, or administrative power. |
| ROLE-AR | `Paryatech Audit Reviewer` custom role | One named approved human per account | Read-only business and privileged evidence. It is classified as commercial-sensitive for read-only Agreement review, but cannot update business records or alter/delete audit evidence. |
| ROLE-RA1 | Built-in Administrator | First named recovery-only human identity | Users, roles, settings, connections, retention, emergency halt, and recovery. Never the person's default operating identity. |
| ROLE-RA2 | Built-in Administrator | Second named recovery-only human identity | Independent recovery path with the same limits; no shared credential, factor, device, or recovery method with ROLE-RA1. |

The planner/data owner is an accountability recorded in C09, not an automatic
permission grant. Combining a planner or commercial duty with another job in the
4–8-person team never combines suppression clearance, recovery administration, or
audit approval into one approval boundary.

### Scoped non-human identity matrix

Create a separate role, credential, owner, expiry/review date, and emergency-revoke
procedure for each admitted integration. Never share an API key across rows.

| ID | Credential / Twenty binding | Allowlisted capability | Explicit denial |
| --- | --- | --- | --- |
| ID-IMP | Temporary API key bound to custom role `Paryatech Import` | Read/update-create N01, N02, C01, C02 and C08; preserve approved provenance and reconciliation state | Messages, attachments, C04 Agreements, C06 Support Receipts, audit, users, roles, settings, connections, keys, native CSV import/export, delete/destroy, and every U5/U6 guarded action |
| ID-COMM | Per-channel application/API identity bound to `Paryatech Communication Intake` only when U5/U7 authorizes it | Read Agency/Contact suppression and active reservation state; create C07 through `recordOutreachOutcome`; create/update its owned C08 exception | Claim/release, suppression clearance, Opportunity/Agreement/Case transitions, mailbox browsing, generic files, audit, exports, administration, and all unrelated objects |
| ID-SUPPORT | Per-channel application/API identity bound to `Paryatech Support Intake` only when U6 authorizes it | Create/replay C06 and attach-or-create C05 through `recordSupportReceipt`; create/update its owned C08 exception | Case resolution/reopen, suppression, sales/commercial, mailbox browsing, audit, exports, administration, and all unrelated objects |
| ID-GOOGLE | Administrator-created Google OAuth connection; not a Twenty workspace member or reusable CRM API key | U7/U8 approved Gmail folders and the dedicated customer-facing primary calendar only | Drive, contacts, unapproved calendars/folders, CRM administration, broad export, and use outside the connected-account pipeline |
| ID-SMTP | Server-side SMTP credential; not a workspace member or CRM API key | Low-volume transactional SMTP configured in U7 | CRM reads, campaign/sequence use, final-delivery inference, UI/log/audit/export exposure |
| ID-AUDIT-W | Application audit ingestion credential outside CRM roles | Write-only ClickHouse ingestion after U9 | Read, update, delete, schema administration, CRM/API access |
| ID-AUDIT-R | Audit Reviewer ClickHouse credential outside CRM roles | Read-only approved audit queries after U9 | Write, update, delete, retention changes, schema administration |
| ID-BACKUP | External platform backup identity outside CRM roles | Write immutable encrypted backup objects and perform the separately approved restore path | Interactive CRM, business-record API, audit deletion, normal operator use |

Google, SMTP, ClickHouse, and backup identities are boundary declarations in U2;
their live credentials and provider configuration belong to U7/U9/U10. Do not invite
them as human workspace members merely to make a probe pass.

### Object permission matrix

Each tuple is
`canReadObjectRecords/canUpdateObjectRecords/canSoftDeleteObjectRecords/canDestroyObjectRecords`.
`A` means true and `D` means false. Set all four role-wide defaults to false for
custom roles, then add only the listed object overrides. All omitted objects are
`D/D/D/D`. Administrator entries reflect the system role and are not custom
overrides.

| Object | ROLE-OP | ROLE-CS | ROLE-LC | ROLE-AR | ROLE-RA1/2 | ID-IMP | ID-COMM | ID-SUPPORT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| N01 Agency | A/A/D/D | A/A/D/D | A/D/D/D | A/D/D/D | Admin | A/A/D/D | A/D/D/D | D/D/D/D |
| N02 Agency Contact | A/A/D/D | A/A/D/D | A/D/D/D | A/D/D/D | Admin | A/A/D/D | A/D/D/D | D/D/D/D |
| N03 Opportunity | A/A/D/D | A/A/D/D | D/D/D/D | A/D/D/D | Admin | D/D/D/D | D/D/D/D | D/D/D/D |
| N04 Task | A/A/D/D | A/A/D/D | A/A/D/D | A/D/D/D | Admin | D/D/D/D | D/D/D/D | D/D/D/D |
| N05 Note | A/A/D/D | A/A/D/D | A/A/D/D | A/D/D/D | Admin | D/D/D/D | D/D/D/D | D/D/D/D |
| C01 Acquisition Source | A/D/D/D | A/D/D/D | A/D/D/D | A/D/D/D | Admin | A/A/D/D | D/D/D/D | D/D/D/D |
| C02 Acquisition Event | A/D/D/D | A/D/D/D | A/D/D/D | A/D/D/D | Admin | A/A/D/D | D/D/D/D | D/D/D/D |
| C03 Product | A/D/D/D | A/D/D/D | D/D/D/D | A/D/D/D | Admin | D/D/D/D | D/D/D/D | D/D/D/D |
| C04 Commercial Agreement | D/D/D/D | A/A/D/D | D/D/D/D | A/D/D/D | Admin | D/D/D/D | D/D/D/D | D/D/D/D |
| C05 Support Case | A/A/D/D | A/A/D/D | A/D/D/D | A/D/D/D | Admin | D/D/D/D | D/D/D/D | A/A/D/D |
| C06 Support Receipt | A/D/D/D | A/D/D/D | A/D/D/D | A/D/D/D | Admin | D/D/D/D | D/D/D/D | A/A/D/D |
| C07 Outreach Event | A/D/D/D | A/D/D/D | A/D/D/D | A/D/D/D | Admin | D/D/D/D | A/A/D/D | D/D/D/D |
| C08 Shared Exception | A/A/D/D | A/A/D/D | A/A/D/D | A/D/D/D | Admin | A/A/D/D | A/A/D/D | A/A/D/D |
| C09 CRM Operating Policy | A/D/D/D | A/D/D/D | A/D/D/D | A/D/D/D | Admin | D/D/D/D | D/D/D/D | D/D/D/D |
| Message / Message Thread | A/D/D/D | A/D/D/D | D/D/D/D | D/D/D/D | Admin | D/D/D/D | D/D/D/D | D/D/D/D |
| Calendar Event | A/D/D/D | A/D/D/D | D/D/D/D | D/D/D/D | Admin | D/D/D/D | D/D/D/D | D/D/D/D |
| Workspace Member, Role, API Key, Connected Account, Workflow, Object/Field Metadata | D/D/D/D | D/D/D/D | D/D/D/D | D/D/D/D | Admin | D/D/D/D | D/D/D/D | D/D/D/D |

C06 records are immutable after creation. ID-SUPPORT's update-create grant exists
because v2.27 has no separate create bit; the U6 pre-query hook and guarded mutation
must deny direct update, soft delete, and destroy after a receipt exists.

### `PermissionFlagType` matrix

`Gate` means false in U2 and granted only after the named later unit passes. `Admin`
means the system Administrator role exposes the capability, but the recovery-use
procedure and separate authorization still apply.

| Flag | ROLE-OP | ROLE-CS | ROLE-LC | ROLE-AR | ROLE-RA1/2 | ID-IMP / ID-COMM / ID-SUPPORT |
| --- | --- | --- | --- | --- | --- | --- |
| `API_KEYS_AND_WEBHOOKS` | D | D | D | D | Admin | D |
| `WORKSPACE` | D | D | D | D | Admin | D |
| `WORKSPACE_MEMBERS` | D | D | D | D | Admin | D |
| `ROLES` | D | D | D | D | Admin | D |
| `DATA_MODEL` | D | D | D | D | Admin | D |
| `SECURITY` | D | D | D | D | Admin | D |
| `WORKFLOWS` | D | D | D | D | Admin | D |
| `IMPERSONATE` | D | D | D | D | Admin | D |
| `SSO_BYPASS` | D | D | D | D | Admin | D |
| `APPLICATIONS` | D | D | D | D | Admin | D |
| `MARKETPLACE_APPS` | D | D | D | D | Admin | D |
| `LAYOUTS` | D | D | D | D | Admin | D |
| `BILLING` | D | D | D | D | Admin | D |
| `AI_SETTINGS` | D | D | D | D | Admin | D |
| `AI` | D | D | D | D | Admin, runtime disabled | D |
| `VIEWS` | A | A | A | A | Admin | D |
| `UPLOAD_FILE` | D | D | D | D | Admin | D |
| `DOWNLOAD_FILE` | Gate: U8 actor/message authorization | Gate: U8 actor/message authorization | D | D | Admin | D |
| `SEND_EMAIL_TOOL` | Gate: U7/U11 transactional-only | Gate: U7/U11 transactional-only | D | D | Admin | D |
| `CREATE_CALENDAR_EVENT_TOOL` | Gate: U7 dedicated calendar | Gate: U7 dedicated calendar | D | D | Admin | D |
| `HTTP_REQUEST_TOOL` | D | D | D | D | Admin, runtime disabled | D |
| `CODE_INTERPRETER_TOOL` | D | D | D | D | Admin, runtime disabled | D |
| `IMPORT_CSV` | D | D | D | D | Admin, separate authorization | D |
| `EXPORT_CSV` | D | D | D | D | Admin, separate authorization | D |
| `CONNECTED_ACCOUNTS` | D | D | D | D | Admin, separate authorization | D |
| `PROFILE_INFORMATION` | A | A | A | A | Admin | D |

An API key can authenticate without receiving `API_KEYS_AND_WEBHOOKS`; that flag
controls key/webhook administration and belongs only to the recovery Administrators.
The import path uses its bound object role and does not use native `IMPORT_CSV`.

### Protected direct-field matrix

Apply `canUpdateFieldValue: false` to every field in PF01–PF08 for every custom human
and integration role unless the table explicitly grants a direct exception. U5/U6
mutations validate actor, current state, evidence, and related records and write these
fields transactionally. A visible field or forged client action never confers write
authority.

| Set | Exact fields | Read policy | Direct update policy |
| --- | --- | --- | --- |
| PF01 Agency lifecycle, ownership, reservation, and metrics | N01 `agencyLifecycle`, `agencyDisposition`, `recordOwner`, `reservationStatus`, `reservationClaimant`, `reservationClaimedAt`, `reservationExpiresAt`, `reservationReleaseReason`, `firstAttemptedAt`, `firstProviderAcceptedAt`, `firstPendingUnknownAt`, `firstContactedAt`, `firstEngagedAt` | ROLE-OP/CS/LC/AR read; integrations read only where their object grant permits | Deny all custom roles and integrations; U5 only |
| PF02 Agency suppression evidence | N01 `isSuppressed`, `suppressionReason`, `suppressedAt`, `suppressionClearedAt`, `suppressionClearanceReason`; N02 same fields | ROLE-OP/CS see only `isSuppressed`; ROLE-LC/AR and Administrators may read all; integrations see only `isSuppressed` where allowlisted | Deny all direct updates; `clearSuppression` requires ROLE-LC, retained evidence, and reason |
| PF03 Opportunity transitions and evidence | N03 `stage`, `amount`, `contacts`, `products`, `nextAction`, `nextActionAt`, `demoScheduledAt`, `demoOccurredAt`, `demoAttendees`, `demoOutcome`, `proposalDeliveredAt`, `commercialDecisionContext`, `lossReason`, `lossDecisionAt`, `revisitAt`, `primarySource`, `influencedSources`, every `trial*` field, and `agreement` | ROLE-OP reads all except `amount`, `commercialDecisionContext`, `agreement`, and commercial Trial evidence; ROLE-CS and ROLE-AR read all; ROLE-LC/integrations read none | Deny direct update; `transitionOpportunity` only |
| PF04 Commercial Agreement | All C04 fields except `restrictedNotes` | ROLE-CS and ROLE-AR read; all other custom roles/integrations cannot read C04 | Deny direct update; `transitionAgreement` only |
| PF05 Private commercial notes | C04 `restrictedNotes` | ROLE-CS and ROLE-AR read; Administrators only for approved recovery; all others hidden | ROLE-CS may update; all others deny |
| PF06 Support receipt and Case transitions | All C06 fields; C05 `sourceReceivedAt`, `responseTargetAt`, `owner`, `status`, `disposition`, `firstSubstantiveResponseAt`, `resolution` | Any role with the object read grant may read; Agreement association remains hidden when C04 is hidden | Deny direct update; U6 receipt, response, and Case actions only |
| PF07 Outreach and exception transitions | All C07 fields; C08 `status`, `lastTrustedState`, `evidence`, `resolvedAt`, `resumeReason`, `resumedAt` | Any role with the object read grant may read | Deny direct update; U5 outreach and U6 exception actions only. C08 `owner`, `dueAt`, and `escalation` remain directly editable by an allowed owner role |
| PF08 Operating policy | All C09 fields | ROLE-OP/CS see operational deadlines only; ROLE-LC sees legal, suppression, and retention entries; ROLE-AR sees the full policy; role-holder identity and recovery fields are Administrator/ROLE-AR only | Administrators only, under separately authorized and audited policy change |

Native record history is required but insufficient: every guarded ownership,
lifecycle, suppression, trial, commercial, activation, adoption, renewal, response,
Case, or exception change must also retain its named reason/evidence fields.

### Guarded action matrix

These are application permissions enforced server-side by
`getParyatechCrmAvailableActions` and the named mutation, not
`PermissionFlagType` values. `Conditional` requires the listed record state,
ownership, field-read/update capability, and evidence. Direct field editing remains
denied even when the action is allowed.

| Guarded action | ROLE-OP | ROLE-CS | ROLE-LC | ROLE-AR | ROLE-RA1/2 | ID-IMP | ID-COMM | ID-SUPPORT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `claimAgency` | Conditional | Conditional | Deny | Deny | Deny for daily work | Deny | Deny | Deny |
| `releaseAgency` | Own active claim only | Own active claim only | Deny | Deny | Audited recovery transfer only | Deny | Deny | Deny |
| `recordOutreachOutcome` | Own active claim | Own active claim | Deny | Deny | Deny for daily work | Deny | Allowlisted provider evidence only | Deny |
| `transitionOpportunity` to Qualified, Demo Scheduled, Demo Completed, Proposal / Commercial Decision, or Lost | Conditional | Conditional | Deny | Deny | Audited correction only | Deny | Deny | Deny |
| `transitionOpportunity` to Negotiation, Awaiting Payment, Paid / Won, or commercial/trial correction/reopen | Deny | Conditional | Deny | Deny | Audited recovery only | Deny | Deny | Deny |
| `transitionAgreement` | Deny | Conditional | Deny | Deny | Audited recovery only | Deny | Deny | Deny |
| `recordSupportReceipt` | Manual source only | Manual source only | Deny | Deny | Emergency recovery only | Deny | Deny | Allowlisted source receipt only |
| `recordSubstantiveResponse` | Assigned Case | Assigned Case | Deny | Deny | Audited correction only | Deny | Deny | Deny |
| `transitionSupportCase` | Assigned Case | Assigned Case | Deny | Deny | Audited correction/reopen only | Deny | Deny | Deny |
| `clearSuppression` | Deny | Deny | Retained evidence and recorded reason only | Deny | Deny; legal boundary remains separate | Deny | Deny | Deny |
| `resumeSharedException` | Assigned operational exception | Assigned operational/commercial exception | Assigned legal/policy exception | Assigned audit exception | Assigned recovery/security exception | Deny | Deny | Deny |

An Administrator may repair access or invoke an explicitly coded recovery path; the
system role does not bypass the server's actor/state/evidence validation. No custom
role may impersonate another actor.

### Individual account and MFA procedure

Twenty v2.27 permits a user to enable two-factor authentication for their own
account; U2 does not claim that a workspace role can force that user setting. Strong
MFA must therefore be enforced in Google Workspace/the approved IdP for every human,
with stronger session policy for ROLE-CS, ROLE-LC, ROLE-AR, ROLE-RA1, and ROLE-RA2.
If local-password sign-in cannot be disabled or the privileged user's Twenty 2FA
enrollment cannot be verified, do not assign the privileged role and keep restricted
rollout closed.

#### Onboarding

1. A recovery Administrator verifies the approved access request, employment/contract
   state, role owner, and corporate identity. Never invite a personal/shared address.
2. Create one individual CRM membership and assign exactly one complete role profile.
   Do not clone a recovery Administrator for routine work.
3. Confirm IdP MFA enrollment, approved factors, session policy, device posture, and
   account-recovery owner. Enable and verify user-controlled Twenty 2FA where the
   local sign-in route remains available; store recovery material outside Git and CRM.
4. Sign in as the new identity in a private desktop-browser session. Run the allowed
   and denied probes for its role, including keyboard/focus access to permitted
   actions. Do not use another user's session.
5. Record only internal account/role IDs, approval reference, MFA assertion result,
   probe result, reviewer, and timestamp in the protected evidence record. Do not
   record email address, factors, recovery codes, tokens, cookies, or screenshots
   containing record content.
6. A different accountable reviewer approves ROLE-CS, ROLE-LC, ROLE-AR, or recovery
   access. Restricted data remains closed until the approval and denial probes pass.

#### Role change and deprovisioning

1. Disable the IdP/corporate account first for termination or suspected compromise;
   for ordinary role change, revoke active CRM sessions before reassignment.
2. Revoke owned API keys, OAuth grants, application tokens, and provider sessions.
   Rotate a shared provider credential only when the departing person could access it.
3. Remove or narrow the workspace role, reassign owned Agencies, Opportunities,
   Tasks, Cases, exceptions, and approval duties without rewriting history.
4. Replace the person in C09 role-holder fields and any on-call/escalation registry.
   Two verified recovery Administrators must remain at every step.
5. Run the old-role denial probes and new-role allow/deny probes from fresh sessions.
   For departure, prove the old identity cannot sign in or call the API.
6. Record reason, approver, actor, timestamp, affected role/account IDs, reassignment
   counts, revocations, observed denial, and exceptions. Retain under the C09 audit
   policy; never retain secrets or PII in the evidence.

Review all memberships, role assignments, recovery identities, API keys, connected
accounts, and external audit/backup identities before Day 0, monthly, and immediately
after any role, employment, provider, or security change.

### Two-Administrator recovery contract

- ROLE-RA1 and ROLE-RA2 are named individual accounts with distinct strong MFA,
  devices, recovery methods, and protected credential custody. Shared break-glass
  credentials are prohibited.
- Each Administrator has a separate least-privileged daily account if they also
  perform operator/commercial work. Recovery identities are not used for email,
  browsing records, routine configuration, or daily queues.
- Before restricted rollout, each Administrator independently signs in, verifies the
  other account remains recoverable, and restores a locked synthetic user in the
  disposable workspace. A second person witnesses role/settings/connection changes.
- A recovery exercise records actor ID, witness ID, reason, start/end time, affected
  setting IDs, expected/observed result, and audit reference. It records no factors,
  recovery codes, session material, or record content.
- Loss of either independent recovery path pauses privileged changes and restricted
  scale-up until a new second Administrator is approved, enrolled, probed, and
  recorded. One remaining Administrator may perform only the minimum recovery needed
  to restore the second path.
- Permanent destroy, broad export, role/object/workflow/retention changes, connection
  changes, SSO bypass, impersonation, and key creation/revocation require a recorded
  reason and second-person authorization even though the system Administrator role
  can technically perform them.

### Suppression-clearance authority

Suppression applies immediately when either the Agency or Contact is suppressed.
ROLE-OP, ROLE-CS, every integration, and both recovery Administrators are denied
`clearSuppression`. Only ROLE-LC may clear it, after verifying the approved basis and
retained minimum evidence and entering the clearance reason. The guarded action
records actor, source observation time, CRM record time, reason/evidence reference,
prior state, and resulting state. A later visible retry is a separate operator action;
clearance never sends or claims automatically. Missing legal/compliance ownership or
a failed clearance denial probe blocks scaled outreach.

### Temporary API-key issue, scope, and revocation

1. A recovery Administrator creates the dedicated custom integration role first with
   all role-wide defaults false and only the exact object/action grants above.
2. Create one API key bound to that role. Set expiry to the approved run window or
   24 hours, whichever is earlier. The key itself receives no
   `API_KEYS_AND_WEBHOOKS`, `IMPORT_CSV`, `EXPORT_CSV`, mailbox, audit, or settings
   permission.
3. Deliver the token once into an encrypted `0600` local environment file or approved
   secret manager. Never place it in Git, shell history, commands, screenshots, logs,
   CRM fields, Notes, audit payloads, or exports.
4. Before source access, run the ID-IMP allow/deny probes with synthetic records.
   Any unexpected read, mutation, export, settings, mailbox, or audit access blocks
   import and requires role repair plus a fresh key.
5. Revoke the key immediately after reconciliation, on any error that may expose it,
   when the operator changes, or at expiry. Delete the local token material.
6. From a fresh process, replay one harmless synthetic read and require an
   authentication denial. Record only key ID/hash fingerprint, role ID, creator,
   approver, issue/expiry/revoke times, scoped counts, probe result, and denial.

Do not rotate an import key into a continuing integration. A later import receives a
new key and repeats the complete scope/denial/revocation proof.

### Browser and API permission probes

Use fictitious records in the disposable workspace and a separate private browser
session/token for every identity. The browser and API must agree; a hidden button is
not authorization evidence, and an API denial does not excuse a leaking browser
field.

| Probe | Identity | Browser operation | API operation | Expected |
| --- | --- | --- | --- | --- |
| BP01/AP01 | ROLE-OP | Open and edit a normal Agency fact; open shared Task/Case | Read/update unprotected N01/C05 field | Allow |
| BP02/AP02 | ROLE-OP | Open Agreement/restricted commercial fields | Read C04 and PF03/PF04/PF05 hidden fields | Deny without value leakage |
| BP03/AP03 | ROLE-OP | Use export, delete/destroy, Settings roles/data model/workflows/connections/API keys | `EXPORT_CSV`, soft-delete/destroy, metadata/settings operations | Deny |
| BP04/AP04 | ROLE-CS | Open Agreement and edit `restrictedNotes`; invoke valid commercial action | Read C04, update PF05, valid `transitionAgreement` | Allow |
| BP05/AP05 | ROLE-CS | Directly edit payment, renewal, activation, adoption, stage, or guarded evidence | Update PF01/PF03/PF04/PF06/PF07 field | Deny; prior state unchanged |
| BP06/AP06 | ROLE-LC | Read suppression evidence and clear a synthetic suppression with evidence/reason | Valid `clearSuppression` | Allow and retain evidence/history |
| BP07/AP07 | ROLE-OP, ROLE-CS, ROLE-RA1/2, integrations | Request suppression clearance | Forged `clearSuppression` | Deny; prior state unchanged |
| BP08/AP08 | ROLE-AR | Read approved Agency, Agreement, policy, and audit evidence | Read permitted business/audit evidence | Allow read-only |
| BP09/AP09 | ROLE-AR | Edit, delete, export, alter retention, or administer users/roles | Mutation/export/settings operation | Deny |
| BP10/AP10 | ROLE-RA1 then ROLE-RA2 | Recover a locked synthetic user and inspect settings | Approved administrative recovery operation | Allow with reason, witness, and audit reference |
| BP11/AP11 | ROLE-RA1/2 daily-account session | Attempt Administrator settings from the least-privileged daily role | Settings operation | Deny |
| BP12/AP12 | ID-IMP | Create/update synthetic Source→Agency→Contact and its exception | Allowlisted N01/N02/C01/C02/C08 operation | Allow; no Opportunity/reservation/owner/contact metric created |
| BP13/AP13 | ID-IMP | Open mailbox, audit, Agreement, export, users, roles, settings, or connections | Corresponding reads/mutations and every guarded U5/U6 action | Deny |
| BP14/AP14 | ID-COMM | Submit allowlisted synthetic provider evidence | Valid `recordOutreachOutcome` after U5 | Allow only the scoped event/exception changes |
| BP15/AP15 | ID-SUPPORT | Replay a synthetic receipt key | `recordSupportReceipt` after U6 | Return existing Case; no duplicate receipt |
| BP16/AP16 | Expired/revoked API key | No browser use | Harmless synthetic read | Authentication denial |
| BP17/AP17 | Any non-Administrator | Open member/role/object/workflow/connection/key settings | Matching metadata/settings API | Deny |
| BP18/AP18 | Any custom role/integration | Soft-delete or destroy any U1 record | Soft-delete/destroy mutation | Deny |

For API probes, keep the token only in an environment variable and each synthetic
GraphQL request in a `0600` temporary file. Send it to the disposable workspace,
capture HTTP status and a normalized `allowed` or `denied` result, and delete the raw
response immediately:

```bash
chmod 600 "$PARYATECH_PROBE_REQUEST"
curl --silent --show-error \
  --output "$PARYATECH_PROBE_RESPONSE" \
  --write-out '%{http_code}\n' \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $PARYATECH_PROBE_TOKEN" \
  --data-binary "@$PARYATECH_PROBE_REQUEST" \
  "$PARYATECH_PROBE_ORIGIN/graphql"
unset PARYATECH_PROBE_TOKEN
```

The variable names are placeholders, not values. The probe operator must normalize a
GraphQL HTTP 200 containing authorization errors as **denied**, verify that a denied
mutation left the record unchanged with a separately authorized read, remove both
temporary files, and never retain response bodies.

### Scrubbed permission-evidence contract

Retain one signed matrix artifact per role/policy version in the protected change
record, outside Git. It contains:

- Twenty version, environment class, workspace ID, metadata-export hash, role ID and
  role-policy version;
- pseudonymous test-identity ID, probe IDs BP01–BP18/AP01–AP18, expected result,
  normalized observed result, timestamp, reviewer ID, and pass/fail;
- all four global object defaults, every object override, every field restriction,
  every `PermissionFlagType` value, and the guarded-action policy version;
- MFA assertion result and enforcing system (`Google Workspace/IdP`, plus
  user-enabled Twenty 2FA where applicable), without factor details;
- API-key ID/hash fingerprint, role, expiry/revocation time, and post-revocation
  denial for temporary identities;
- ROLE-RA1/ROLE-RA2 recovery result and second-person authorization references;
- suppression-clearance allow/deny result; and
- exceptions, last trusted state, owner, due/escalation, reconciliation evidence,
  explicit resume, and final sign-off by the role owner and Audit Reviewer.

Exclude names, email addresses, phone numbers, credentials, tokens, cookies, session
IDs, MFA factors/recovery material, provider payloads, source rows, message content,
attachments, customer/Agency content, and raw GraphQL responses. Retain the scrubbed
artifact under C09 `auditRetentionDays`. Audit evidence is not considered protected
or tamper-evident until U9 provides the entitled ClickHouse path; that missing gate
blocks high-risk/restricted rollout rather than being waived.

## U3 native operating-surface contract

Configure these surfaces only after U1 metadata and U2 roles reproduce successfully
in a disposable Twenty v2.27 workspace. U3 uses native views, dashboards, Tasks,
Notes, and notification workflows. It creates no custom dashboard, mobile surface,
campaign, scoring system, or generic automation framework.

### Time, counting, and visibility rules

- Dashboard date filters use the viewing user's local timezone. The reviewer records
  that timezone beside every captured total.
- Business deadlines do not use viewer-local calendar arithmetic. U5/U6 calculate
  `reservationExpiresAt`, `pendingExpiresAt`, and `responseTargetAt` from the active
  C09 `businessCalendar`; views only compare the stored timestamp with `now`.
- Day-30 and Day-90 windows begin at C09 `effectiveAt` in the policy timezone and end
  at the recorded checkpoint instant. Never infer a business deadline from a
  dashboard's relative-date filter.
- A Contacted total is `count(N01 Agency)` where `firstContactedAt` is in the approved
  window. Never count People, Outreach Events, messages, recipients, phone numbers,
  Opportunities, or rows. One Agency with several Contacts or qualifying events
  counts once.
- Attempted, Provider Accepted/Completed Call, ever Pending/Unknown, Contacted, and
  Engaged are separate Agency-grain counts using the corresponding N01 first-evidence
  timestamp. A later state never rewrites an earlier metric.
- The support-capture denominator is every unique C06 `receiptKey` observed at a
  source. Count C06 Support Receipts, not Cases. Replays return the existing Receipt;
  receipts attached to the same Case, unresolved identity, late, duplicate, and
  non-support dispositions remain in the denominator.
- Native dashboards cannot prove off-CRM omissions. The approved sampling review
  compares source-observed unique receipt keys with C06 keys and records the
  numerator, denominator, unexplained difference, owner, and decision outside a
  shared dashboard.
- A workspace-shared dashboard may use only objects and fields readable by ROLE-OP.
  Never place C04, N03 `amount`, commercial/trial evidence, payment/waiver/refund/
  reversal/net values, renewal terms, private notes, suppression evidence, role
  holders, or restricted policy inputs in a shared widget, title, group, filter, or
  drill-down.
- Commercial, adoption, renewal, and activation review stays in ROLE-CS/ROLE-AR
  permission-protected object views. Do not create or share aggregate widgets that
  could reveal hidden values to ROLE-OP through labels, totals, tooltips, URLs,
  exports, or cached drill-downs.

### View creation recipe

Create the views in ID order. Use the exact name, object, visible columns, filters,
grouping, and sort below. `now` is evaluated in the viewer's timezone only for list
display; stored business-calendar deadlines remain authoritative. Each view owner
must be a named C09 role holder or the named queue owner recorded in the change
record.

| ID / exact name | Object and audience | Visible fields | Exact filters | Group and sort | Owner; empty state; error state |
| --- | --- | --- | --- | --- | --- |
| V01 `CRM · Shared Pool` | N01; ROLE-OP/CS | `name`, `geography`, `specializations`, `acquisitionCohorts`, `originalAcquisitionSource`, `agencyLifecycle`, `agencyDisposition`, `isSuppressed`, `reservationStatus`, `reservationClaimant`, `reservationExpiresAt` | `agencyLifecycle = Imported / Uncontacted`; `agencyDisposition = Eligible`; `isSuppressed = false`; reservation is empty, Released, or Expired | Group `acquisitionCohorts`; sort `reservationExpiresAt` ascending with empty first, then `name` ascending | Source-supply owner. Empty: inspect V02/V04/V05 and source gate; never loosen filters. Error/partial load: stop claiming and open owned C08 exception from last trusted state. |
| V02 `CRM · Active Reservations` | N01; ROLE-OP/CS | `name`, `reservationClaimant`, `reservationClaimedAt`, `reservationExpiresAt`, `agencyDisposition`, `isSuppressed` | `reservationStatus = Claimed`; `reservationExpiresAt > now`; `isSuppressed = false` | Group `reservationClaimant`; sort `reservationExpiresAt` ascending, then `name` | Operator lead. Empty: valid if V01 has eligible supply. Error: stop claims/releases; do not infer expiry or owner. |
| V03 `CRM · Pending Unknown Reconciliation` | C07; ROLE-OP/CS | `eventReference`, `agency`, `contact`, `operator`, `channel`, `initiatedAt`, `outcome`, `providerObservedAt`, `pendingExpiresAt`, `nextAction`, `nextActionAt`, `reasonedRetry` | `outcome = Pending / Unknown`; `pendingExpiresAt is not empty` | Group `operator`; sort `pendingExpiresAt` ascending, then `initiatedAt` ascending | Communication-reconciliation owner. Empty: no unresolved Pending/Unknown. Error: pause reasoned retry and provider reconciliation; never count Contacted. |
| V04A `CRM · Suppressed Agencies` | N01; ROLE-OP/CS see state, ROLE-LC sees evidence | `name`, `isSuppressed`, `agencyDisposition`, `suppressedAt`; ROLE-LC additionally `suppressionReason`, `suppressionClearedAt`, `suppressionClearanceReason` | `isSuppressed = true` OR `agencyDisposition = Suppressed` | Group `agencyDisposition`; sort `suppressedAt` descending | Legal/compliance owner. Empty: valid only after BP07/AP07 denial probe. Error: block outbound globally for the affected records. |
| V04B `CRM · Suppressed Contacts` | N02; same audiences | `name`, `company`, `contactStatus`, `isSuppressed`, `suppressedAt`; ROLE-LC evidence fields only | `isSuppressed = true` | Group `company`; sort `suppressedAt` descending | Legal/compliance owner. Empty/error behavior matches V04A. |
| V05 `CRM · Identity Quarantine` | C08; ROLE-OP/CS, planner, audit read | `exceptionReference`, `affectedObject`, `affectedRecordId`, `status`, `lastTrustedState`, `owner`, `dueAt`, `escalation` | `capability = Import`; `status in New, Investigating, Blocked, Reopened` | Group `status`, then `affectedObject`; sort `dueAt` ascending with empty last | Data owner. Empty: no unresolved identity quarantine. Error: stop affected import/match work; never auto-merge or use latest-write-wins. |
| V06 `CRM · Due Support` | C05; ROLE-OP/CS | `caseReference`, `subject`, `priority`, `sourceReceivedAt`, `responseTargetAt`, `owner`, `status`, `disposition`, `firstSubstantiveResponseAt`, `escalation` | `status in New, Assigned, In Progress, Waiting on Agency, Waiting Internal`; and (`responseTargetAt <= now` OR `priority = Urgent`) | Group `priority`, then `owner`; sort `responseTargetAt` ascending, then `sourceReceivedAt` | Support owner. Empty: confirm C06 receipts still reconcile to source. Error: treat source receipts as authoritative, pause dashboard claims, and open/assign from the receipt path. |
| V07A `CRM · Due Renewals` | C04; ROLE-CS/AR only | `agreementReference`, `agency`, `products`, `renewalState`, `renewalAt`, `renewalOwner`, `renewalNextAction`, `renewalNextActionAt`, `evidenceState` | `renewalState in Renewing, Changed`; `renewalAt <= now + 30 days` | Group `renewalOwner`, then `renewalState`; sort `renewalNextActionAt` ascending, then `renewalAt` | Commercial owner. Empty: no due approved Agreement. Error: do not expose or copy values into shared Tasks/Notes; pause commercial action. |
| V07B `CRM · Activation Review` | C04; ROLE-CS/AR only | `agreementReference`, `agency`, `activationState`, `activationConfirmedAt`, `activationConfirmer`, `evidenceState` | `activationState in Pending, Review Required` | Group `activationState`; sort `startsAt` ascending, then `agreementReference` | Commercial owner. Empty: no activation review. Error: preserve ParyatechOS as entitlement authority and create an owned C08 exception. |
| V08 `CRM · Overdue Sales Actions` | N03; ROLE-OP/CS | `name`, `company`, `owner`, `stage`, `nextAction`, `nextActionAt`, `demoScheduledAt` | `stage not in Paid / Won, Lost`; `nextActionAt < now` | Group `owner`, then `stage`; sort `nextActionAt` ascending | Sales owner. Empty: no overdue recorded action; it does not prove completeness. Error: do not advance stage or edit guarded evidence directly. |
| V09 `CRM · Commercial Evidence Staleness` | C04; ROLE-CS/AR only | `agreementReference`, `agency`, `paymentState`, `renewalState`, `evidenceSource`, `evidenceType`, `evidenceVerifier`, `evidenceObservedAt`, `evidenceRecordedAt`, `evidenceState`, `renewalNextActionAt` | `evidenceState in Stale, Conflict` OR (`evidenceState = Current` AND `evidenceObservedAt` is older than the C09 reconciliation cadence recorded in policy evidence) | Group `evidenceState`, then `evidenceVerifier`; sort `evidenceObservedAt` ascending | Commercial owner. Empty: no known stale/conflict evidence. Error: stop dependent commercial changes; never assume Current. |
| V10A `CRM · Audit Security Recovery Exceptions` | C08; ROLE-AR and ROLE-RA1/2 | `exceptionReference`, `capability`, `affectedObject`, `affectedRecordId`, `status`, `lastTrustedState`, `owner`, `dueAt`, `escalation`, `resolvedAt`, `resumedAt` | `capability in Audit, Security, Recovery`; `status in New, Investigating, Blocked, Reopened` | Group `capability`, then `status`; sort `dueAt` ascending with empty last | Audit Reviewer. Empty: no recorded open exception, not proof the gate passed. Error: pause restricted rollout. |
| V10B `CRM · Integration Health Exceptions` | C08; ROLE-OP/CS and planner | `exceptionReference`, `capability`, `affectedObject`, `status`, `lastTrustedState`, `owner`, `dueAt`, `escalation`, `resolvedAt`, `resumedAt` | `capability in Mailbox, SMTP, Integration`; `status in New, Investigating, Blocked, Reopened` | Group `capability`, then `status`; sort `dueAt` ascending | Integration owner. Empty: no open recorded integration exception. Error: pause only the affected capability unless exposure/recovery/reconstructability fails. |
| V11A `CRM · Source Supply` | C01; ROLE-OP/CS and planner | `name`, `sourceType`, `sourceBatch`, `outreachBasis`, `owner`, `active`; cost fields hidden | `active = true` | Group `sourceType`; sort `sourceBatch` ascending, then `name` | Source-supply owner. Empty: source-sufficiency gate fails; do not count inventory as contact. Error: stop scale-up, preserve target/legal gates. |
| V11B `CRM · Capacity Policy Evidence` | C09; planner and ROLE-AR | `policyVersion`, `effectiveAt`, `businessCalendar`, `pilotThresholds`, `pilotBatchReference`, `sourceYieldAndReplenishmentPlan`, `capacityInputs`, `sourceSupplyOwner`, `capacityOwner`, `commercialTargetOwner`, `day30TargetLockAt` | `active = true` | No grouping; sort `effectiveAt` descending | Capacity owner. Empty or more than one row: policy gate fails. Error: pause capacity decision and preserve risk-first work order. |
| V12 `CRM · Adoption Review` | C04; ROLE-CS/AR only | `agreementReference`, `agency`, `products`, `activationState`, `adoptionState`, `adoptionEvidence`, `adoptionObservedAt`, `evidenceState` | `activationState = Confirmed`; `adoptionState in Not Assessed, Evidence Tracking, Milestone Recorded` | Group `adoptionState`; sort `adoptionObservedAt` ascending with empty first | Commercial/adoption owner. Empty: no activated Agreement requiring review. Error: do not infer adoption from entitlement or message activity. |

Twenty view filters do not replace server authorization. After saving each view,
repeat it as ROLE-OP, ROLE-CS, ROLE-LC, and ROLE-AR; verify hidden fields neither
render nor appear in filter/group/sort selectors, URLs, exports, or drill-downs.

### Dashboard recipes

#### D01 `CRM · Shared Operations`

Share D01 workspace-wide only after ROLE-OP can read every source field. Do not add a
widget merely because an Administrator can preview it.

| Widget | Native source and aggregation | Exact filter/group | Expected interpretation |
| --- | --- | --- | --- |
| D01-W01 Attempted Agencies | Count N01 records | `firstAttemptedAt is not empty`; checkpoint window when reviewing Day 30/90 | Unique Agencies attempted |
| D01-W02 Provider Accepted / Completed Call Agencies | Count N01 | `firstProviderAcceptedAt is not empty`; same window | Acceptance/completed call, not Contacted |
| D01-W03 Ever Pending / Unknown Agencies | Count N01 | `firstPendingUnknownAt is not empty`; same window | Ever pending; use V03 for unresolved work |
| D01-W04 Contacted Agencies | Count N01 | Copy the approved C09 window start and checkpoint into static dashboard filter values: `firstContactedAt >= WINDOW_START_STATIC` and `< CHECKPOINT_STATIC`; no Person/Event grouping | Canonical unique Contacted numerator for 333/1,000 |
| D01-W05 Engaged Agencies | Count N01 | `firstEngagedAt is not empty`; checkpoint window | Unique two-way engagement |
| D01-W06 Opportunity Funnel | Count N03 | Group `stage`; no amount or commercial fields | Pursuit count by canonical stage |
| D01-W07 Demo Performance | Count N03 | Group by `demoOccurredAt` present/empty and approved cohort; exclude hidden commercial fields | Demo scheduled/completed baseline; conversion is reviewed from counts |
| D01-W08 Due Support | Count C05 | Same open-status/urgent-or-due filter as V06; group `priority` | Current response workload, not capture denominator |
| D01-W09 Captured Support Receipts | Count C06 | All records by unique `receiptKey`; group `receiptDisposition` | CRM-side support denominator including duplicate/non-support |
| D01-W10 Overdue Tasks | Count N04 | Incomplete Task and due time `< now`; group assignee | Accountable workload |
| D01-W11 Reviewed Eligible Supply | Count N01 | `agencyLifecycle = Imported / Uncontacted`; `agencyDisposition = Eligible`; `isSuppressed = false` | Supply inventory, never Contacted |
| D01-W12 Open Operational Exceptions | Count C08 | `status in New, Investigating, Blocked, Reopened`; exclude commercial-only evidence fields; group `capability` | Visible capability risk |

Layout order is D01-W08, D01-W12, D01-W10, D01-W04, D01-W01–W03, D01-W05–W07,
D01-W09, D01-W11 so risk/customer obligations precede volume.

D01-W04 does not compare N01 dynamically with a C09 record. At each approved Day-0,
Day-30, or Day-90 policy review, copy the approved instants into
`WINDOW_START_STATIC` and `CHECKPOINT_STATIC`, record both timestamps and the C09
`policyVersion` in the protected change evidence, and update the widget only through
that approved policy-review change. A viewer, workflow, or routine dashboard editor
must not advance either value.

#### D02 `CRM · Planner Supply and Capacity`

Share D02 only if every widget uses ROLE-OP-visible data. Add:

1. reviewed eligible unsuppressed N01 count grouped by `originalAcquisitionSource`;
2. N01 source-batch counts grouped by `acquisitionCohorts`;
3. unique N01 Contacted count using `firstContactedAt`, never Event/Person rows;
4. open C08 Import/Integration exceptions by owner and due date;
5. incomplete N04 capacity/source-review Tasks by assignee and due date; and
6. a text tile naming the active C09 policy version and checkpoint timezone, without
   capacity inputs, role-holder identities, retention values, or commercial targets.

Do not create a workspace-shared commercial dashboard. ROLE-CS/ROLE-AR use V07A,
V07B, V09, and V12 for gross booked, waived, refunded/reversed, net collected,
renewal, activation, adoption, and Opportunity-grain source review. ROI uses C04
`netCollected`, one N03 `primarySource`, and non-additive `influencedSources`; never
sum revenue once per influenced source.

For both dashboards define:

- empty: show zero with the metric definition and link to its source view; never hide
  a zero or replace it with a success statement;
- loading/error: show no stale total as current; record the last successful refresh
  time, stop the affected decision, and open C08 when the failure persists;
- permission mismatch: unshare the dashboard or remove the widget immediately,
  capture only scrubbed configuration evidence, and run the U2 denial probes;
- drill-down: must land on the exact filtered native view and preserve role-based
  field restrictions.

### Task and Note recipes

Tasks are accountable work, not lifecycle state. Every Task requires `title`,
assignee, due timestamp, status, and one primary related N01/N03/C04/C05/C08 record.
The title contains no sensitive value.

| ID / title pattern | Relation and assignee | Required body fields | Completion evidence |
| --- | --- | --- | --- |
| T01 `Support · <case reference> · respond` | C05; Case owner | priority, response target, next action | Substantive-response action reference; acknowledgement alone is insufficient |
| T02 `Exception · <capability> · reconcile` | C08; exception owner | last trusted state reference, due/escalation, required gate | Reconciliation evidence and explicit `resumeSharedException` reference |
| T03 `Sales · <opportunity reference> · next action` | N03; Opportunity owner | next action and due time | Guarded transition/outreach evidence or reasoned reschedule |
| T04 `Commercial · <agreement reference> · review` | C04; ROLE-CS owner | restricted evidence reference and due time; never amount in title | Guarded Agreement action reference |
| T05 `Source · replenish reviewed supply` | C01/C09; source-supply owner | yield, dated source action, gate date | Updated approved supply decision |
| T06 `Capacity · weekly forecast` | C09; capacity owner | available operator time, observed Agency/Case time, required pace | Recorded staffing/rotation/scope decision |
| T07 `Suppression · legal review` | N01/N02; ROLE-LC | evidence reference and review due time; no retry instruction | `clearSuppression` action or retained-suppression decision |
| T08 `Activation or adoption · review` | C04; ROLE-CS owner | expected evidence and due time; no entitlement mutation | Guarded activation/adoption action or owned exception |
| T09 `Official-channel exception · <Agency or Contact reference> · follow up` | N01 or N02; Operator who owns the follow-up | official or personal exception channel, source time, participants by CRM record reference, minimal evidence reference, outcome, next action, and due time; no phone number or message content | NTE01 reference plus guarded outreach outcome or an explicit no-contact/escalation decision |

Use Notes only for concise human context visible to every reader of the related
record. Never copy commercial values into a shared Note.

| ID / exact Note heading | Required content | Prohibited content |
| --- | --- | --- |
| NTE01 `Official-channel exception` | source time, participants by CRM record reference, channel, minimal evidence reference, outcome, next action, owner | message transcript, personal number, attachment, secret, unnecessary PII |
| NTE02 `Operational handoff` | last trusted state, completed action references, next action, owner, due/escalation | hidden commercial, suppression, MFA, credential, or provider payload |
| NTE03 `Source context` | source/event references, reviewed classification decision, reviewer and time | raw source row, guessed identity, copied spreadsheet content |
| NTE04 `Meeting or call summary` | occurred-at, CRM participant references, outcome, next action, owner | recording/transcript unless separately approved; payment or identity documents |

Commercial notes remain C04 `restrictedNotes`; suppression evidence remains protected
fields; privileged audit/recovery evidence remains the U2/U9 evidence path.

### Notification-only workflow recipes

Native workflow record searches are capped at 200 records. Every workflow below sets
an explicit maximum of 200, sorts the most urgent records first, and sends a
notification only. It never changes lifecycle, ownership, suppression, stage,
commercial, activation, adoption, renewal, Case, receipt, or exception state. If a
search returns 200, the notification must say `SEARCH CAP REACHED` and direct the
owner to the complete native view and a manual C08 capacity/integration exception;
the workflow output must not be reported as a complete count.

| ID / exact name | Schedule/search | Recipient and notification |
| --- | --- | --- |
| WF01 `CRM · Pending Unknown due` | Every 30 minutes; C07 Pending/Unknown with `pendingExpiresAt <= now + 2 hours`; sort expiry ascending; 200 max | Event operator and communication owner: event reference, deadline, next action; no message body |
| WF02 `CRM · Support response due` | Every 15 minutes; C05 open status with `responseTargetAt <= now + 30 minutes` OR Urgent; sort priority then target; 200 max | Case owner and support escalation owner: case reference, priority, target |
| WF03 `CRM · Renewal activation due` | Daily in C09 business timezone; C04 due within 30 days or activation Pending/Review Required; sort next action/renewal ascending; 200 max | ROLE-CS renewal owner only; Agreement reference and due action, no amount |
| WF04 `CRM · Sales action overdue` | Daily in C09 business timezone; N03 active stage and `nextActionAt < now`; sort due ascending; 200 max | Opportunity owner and sales owner: Opportunity reference and next action |
| WF05 `CRM · Exception due` | Hourly; C08 active status and `dueAt <= now + 2 hours`; sort due ascending; 200 max | Exception owner and escalation owner: capability, reference, due time |
| WF06 `CRM · Weekly source capacity review` | Weekly at the C09-approved business time; search the one active C09 record; 200 max | Source-supply owner, capacity owner, planner: open V11A/V11B and D02; record go/no-go |
| WF07 `CRM · Weekly audit policy review` | Weekly at approved business time; C08 Audit/Security/Recovery active, sort due; 200 max | ROLE-AR and recovery owners: open V10A and verify policy/audit gate |
| WF08 `CRM · Personal channel follow-up due` | Hourly; incomplete N04 Tasks whose title begins exactly `Official-channel exception ·` and due `< now`; 200 max | Task owner: record reference and due time only |

Reservation expiry is the single launch state-changing automation exception. It is
not a U3 native workflow: the bounded, idempotent U5 expiry job alone may change N01
`reservationStatus` from Claimed to Expired after the C09 interval. It must not set a
durable owner, contact metric, new claimant, Task, or outbound action. All other U3
workflows remain notification-only.

### Daily operating procedures

#### Operator and Commercial Sensitive queue order

1. Open D01. Confirm the viewer-local timezone, last refresh, and absence of a
   permission/error banner.
2. Work V06 Urgent/overdue Support and assigned V10B security/integration exceptions
   first. Source receipts remain authoritative if the view fails.
3. ROLE-CS works V07A/V07B due renewal and activation next; ROLE-OP works only an
   assigned T08 that contains no restricted commercial value.
4. Work V08 overdue owned sales actions. Use the typed guarded action; never edit a
   protected field to clear the queue.
5. Reconcile V03 Pending/Unknown before any retry. After expiry, require the visible
   reasoned-retry path and keep Contacted unchanged without qualifying evidence.
6. Only then select eligible work from V01 and claim through `claimAgency`. Confirm
   V02 shows exactly one active claimant before outreach.
7. Record manual official/personal-channel exceptions with NTE01 and a dated Task.
8. End the shift with every active Case, reservation, Opportunity, and exception
   having an owner and dated next action, or an explicit escalation.

Queue volume never overrides suppression, identity, evidence, legal, audit, recovery,
or capacity gates.

#### Planner, data-owner, Audit Reviewer, and recovery review

1. Open V10A/V10B for audit, security, recovery, and integration risk. A recovery,
   monitoring, exposure, or reconstructability failure pauses restricted rollout.
2. Open V05; resolve or keep quarantined every identity decision without automatic
   merge.
3. Review V11A, V11B, and D02. Calculate weekly required pace for 333 Day-30 and
   1,000 Day-90 Contacted Agencies from the policy checkpoint, current unique
   Contacted count, reviewed-to-contactable yield, dated replenishment, available
   operator time after higher-priority work, and observed time per Agency/Case.
4. If supply is short, choose approved source acquisition, target/timeline revision,
   or stopped scale-up. If capacity is short, change staffing, rotation, or rollout
   scope. Never relax identity, suppression, legal, or risk-first priority.
5. ROLE-CS/ROLE-AR review V09 and V12 plus V07A/V07B. Keep commercial evidence,
   adoption, and target decisions outside shared dashboards.
6. At Day 30, lock the target generated by the Day-0-approved formula and evidentiary
   floor. At Day 90, report pass/fail against that unchanged target separately from
   narrative variance and create the named product decision on failure.
7. Sample off-CRM support/manual-channel evidence against C06/NTE01, report omissions,
   capture latency, duplicates, workflow adherence, and observed effort, and let
   failed thresholds stop scale-up.
8. Review parallel tracker retirement only after Twenty proves the tracker's purpose
   through reconciled records and the owning gate.

### Keyboard, empty, and error-state smoke contract

For every V01–V12 and D01–D02 surface, test as each allowed role at desktop width:

1. Use native left navigation and view/dashboard selectors without a pointer.
2. Use Tab/Shift+Tab to reach the view selector, filters, groups, sort controls,
   table rows/cards, pagination, drill-down, and permitted command button; activate
   with Enter/Space and return with Escape/browser Back.
3. Confirm focus remains visible, follows DOM order, returns to the invoking control
   after close/error/success, and does not enter hidden commercial controls.
4. Verify populated, empty, loading, permission-denied, and source/query-error states.
   Empty must mean the exact filter has zero rows, not that data failed to load.
5. On partial/error state, do not take state-changing action from the incomplete
   surface. Refresh once, preserve last trusted state, assign C08, pause only the
   affected capability unless recovery/exposure/reconstructability requires broader
   pause, and resume explicitly after evidence passes.

U5/U6 record commands are future dependencies: U3 records their required keyboard
path and expected placement but cannot claim their runtime behavior before those
units land.

### Reconciled synthetic fixture totals

Use fictitious records only. The disposable fixture must produce these exact totals:

| Fixture | Records | Expected native result |
| --- | --- | --- |
| Outreach | Six Agencies: one Attempted only; one Provider Accepted only; one Pending/Unknown; one reached call; one delivered email later Engaged; one Agency with two Contacts and two qualifying events | Attempted 6; Provider Accepted/Completed Call 4; ever Pending/Unknown 1; unique Contacted 3; unique Engaged 1. The multi-Contact Agency counts once. |
| Opportunity attribution | The multi-Contact Agency has one Opportunity, one Primary Source, two non-additive Influenced Sources, and one Agreement | Funnel Opportunity 1; Agreement revenue represented once; ROI uses one Agreement `netCollected` against its Primary Source and never triples revenue. |
| Support | Six unique source `receiptKey` values: two attach to one verified open Case; one new late Case; one duplicate disposition; one non-support disposition; one unknown-identity owned Case | C06 denominator 6; C06 captured 6; Cases 5; duplicate 1; non-support 1; unknown identity 1. Replaying any key leaves all totals unchanged. |
| Shared visibility | One restricted Agreement with payment/private-note values related to a broadly visible Agency and Case | ROLE-OP sees Agency/Case and identical safe D01 totals, but no restricted value, widget, tooltip, filter, URL, export, or drill-down leakage. ROLE-CS sees the protected object view. |
| Source/capacity stop | Policy inputs cannot support the required weekly pace | D02 shows only safe supply/work counts; review records stopped scale-up or an owned staffing/rotation/scope/source correction without changing Contacted totals. |

Record source-view row count, dashboard value, fixture expectation, viewer timezone,
role, timestamp, and pass/fail. Delete synthetic records and screenshots containing
record content after the smoke.

### U3 creation and rollback

1. Export the U1/U2 disposable baseline and record its scrubbed hash.
2. Create V01–V12, then D01/D02, then T01–T09/NTE01–NTE04 templates, then
   WF01–WF08. Do not enable a workflow until its 200-cap and recipients are verified.
3. Load the synthetic fixture, run role-by-role desktop smoke, reconcile the exact
   totals, and rerun U2 commercial-field denial probes through dashboard drill-down.
4. Disable WF08→WF01 in reverse order before rollback. Remove D02/D01 widgets and
   dashboards, then V12→V01, and delete only synthetic Tasks, Notes, and records.
5. Restore the U1/U2 baseline in the disposable workspace and compare its hash.
6. In an approved live change, never delete real Tasks, Notes, or history to undo a
   surface. Disable notifications, unshare/remove leaking widgets, hide the affected
   view, open an owned exception, and restore the last approved surface configuration.
7. Any commercial leak requires immediate unshare/removal, session/cache review,
   scrubbed incident evidence, U2 permission re-probe, and Audit Reviewer sign-off
   before resharing.

## Metadata creation recipe

Perform only in a disposable v2.27 workspace until the verification section passes.

1. Export the untouched disposable workspace metadata as the rollback baseline.
2. Re-label native Company and Person to Agency and Agency Contact. Confirm N01–N05
   remain the native objects.
3. Create C01, C03, C05, C07, C08, and C09 without relations.
4. Create C02 after C01, C04 after C03, and C06 after C05.
5. Add non-relation fields in object-ID order using the exact internal names, types,
   requiredness, and ordered options above.
6. Add REL01–REL19 in relation-ID order. Confirm inverse fields and cardinality before
   continuing to the next relation.
7. Apply unique constraints and defaults: Agency lifecycle `Imported / Uncontacted`,
   Agency disposition `Eligible`, Contact status `Unknown`, suppression false,
   Product active true, Agreement activation `Pending`, Agreement adoption
   `Not Assessed`, and Policy active true. Do not default Trial.
8. Create one synthetic C09 record using fictitious references and exact fixed values;
   set `pendingUnknownMaxBusinessDays` to 2. Exercise both mirror-retention outcomes
   in the disposable workspace, ending with accepted=true only for recreate proof.
9. Export a scrubbed post-configuration metadata inventory. Compare objects, fields,
   types, options and order, requiredness, relations, inverses, uniqueness, and
   defaults against this runbook.
10. Record generated metadata IDs and universal identifiers in the protected change
    record, not in Git. Delete all synthetic records after verification.
11. Production creation requires a separate approved change using the verified export
    and policy owners. This runbook does not grant that approval.

## Rollback contract

### Disposable workspace

- Before records exist: restore the baseline metadata export or remove relations in
  reverse REL19→REL01 order, then remove C09→C01 in reverse dependency order.
- After synthetic records exist: export scrubbed evidence, delete synthetic records,
  then restore the baseline. Never drop an object while a relation or record remains.
- A failed comparison invalidates the disposable workspace; correct the recipe and
  recreate from a fresh baseline instead of editing around unexplained drift.

### Approved production change

- Before live import: stop the change, export the failed metadata state, and restore
  the pre-change metadata/database snapshot through the approved deployment runbook.
- After live data exists: do not delete objects, fields, options, or relations. Freeze
  dependent work, open a Shared Exception when available, preserve the last trusted
  state, and restore/reconcile through an approved recovery change.
- Never rename an internal field to conceal drift. Add no compatibility alias without
  a Product Contract and migration decision.

## Recreate and comparison contract

A recreation passes only when a fresh disposable v2.27 workspace can be configured
from this document without source data or prior workspace IDs and produces:

- N01–N05 reused, C01–C09 created once, and no parallel core objects;
- every listed internal field with matching type and requiredness marker;
- every fixed select with exact spelling and order;
- REL01–REL19 with matching target, cardinality, and inverse;
- every unique key and default invariant;
- one active policy with Pending / Unknown = 2 and accepted provider-mirror semantics;
- zero Opportunities, owners, reservations, Outreach Events, Cases, or contact counts
  created merely by metadata setup; and
- zero secrets, real PII, source content, mailbox content, or attachment content.

The comparison evidence records Twenty version, workspace ID, operator, timestamp,
baseline export hash, configured export hash, pass/fail per inventory section, and
rollback result in the protected change record. Do not commit those values.

## Verification and no-test exception

**No-test exception:** U1–U3 change documentation and manual Twenty Settings recipes
only; they change no executable behavior. Application tests would not prove a
configured workspace role matrix, provider-side MFA, native view/dashboard behavior,
viewer-local timezone, workflow recipients, or keyboard focus. Deterministic document
checks and the later disposable-workspace browser smoke are the replacement evidence:

1. `git diff --check -- docs/operations/paryatech-crm-runbook.md`
2. Heading and identifier consistency: one H1; unique N01–N05, C01–C09, and
   REL01–REL19 declarations; unique ROLE-OP, ROLE-CS, ROLE-LC, ROLE-AR, ROLE-RA1,
   ROLE-RA2, ID-IMP, ID-COMM, ID-SUPPORT, ID-GOOGLE, ID-SMTP, ID-AUDIT-W,
   ID-AUDIT-R, and ID-BACKUP identity declarations; every relation, role, identity,
   protected-field set, and probe reference resolves to a declaration.
3. U1 recipe completeness: scope, fixed vocabularies, native/custom field
   inventories, relation inventory, constraints, policy gate, creation order,
   rollback, and recreate contract are present.
4. U2 matrix completeness: all 26 source `PermissionFlagType` values appear exactly
   in the capability inventory and once as rows in the flag matrix; all four actual
   object permission booleans and both field permission booleans are named; every U1
   object, human role, scoped identity, PF01–PF08 set, guarded U5/U6 action, and
   BP01–BP18/AP01–AP18 probe is covered.
5. Denied-power check: every non-Administrator role denies `EXPORT_CSV`,
   soft-delete/destroy, `WORKSPACE_MEMBERS`, `ROLES`, `DATA_MODEL`, `WORKFLOWS`,
   `CONNECTED_ACCOUNTS`, and `API_KEYS_AND_WEBHOOKS`; ID-IMP also denies mailbox,
   audit, C04, native import/export, and all guarded actions; only ROLE-LC may
   `clearSuppression`; ROLE-AR is read-only; direct PF01–PF08 mutations are denied
   except ROLE-CS editing PF05 and separately authorized Administrator policy work.
6. Identity lifecycle check: individual-account onboarding, Google Workspace/IdP MFA
   enforcement and user-enabled Twenty 2FA limitation, role-change/deprovisioning,
   two independent recovery Administrators, temporary-key issue/revocation and
   post-revocation denial, separate integration boundaries, browser/API probes, and
   the scrubbed signed evidence contract are present.
7. U3 surface completeness: V01–V12 including the A/B split views, D01/D02,
   D01-W01–D01-W12, T01–T09, NTE01–NTE04, and WF01–WF08 are each declared exactly
   once; every view row names object/audience, visible fields, exact filters,
   group/sort, owner, empty behavior, and error behavior.
8. U3 counting and leakage check: Contacted counts N01 `firstContactedAt`; C06 unique
   `receiptKey` is the support denominator; duplicate/non-support/unresolved receipts
   remain; Opportunity-grain Primary Source revenue counts once; shared dashboards
   contain no C04/commercial/private/suppression/role-holder values or leaking
   filters, tooltips, URLs, exports, caches, or drill-downs.
9. U3 time/automation check: viewer-local dashboard timezone and C09 business-time
   deadlines are distinct; every WF01–WF08 search is bounded to 200, treats a full
   page as `SEARCH CAP REACHED`, and notifies only; bounded idempotent U5 reservation
   expiry is the sole state-changing automation exception.
10. U3 procedure/evidence check: risk-first operator order, planner/admin reviews,
    populated/empty/loading/denied/error and keyboard/focus paths, exact synthetic
    outreach/support/attribution/visibility/capacity totals, configuration order, and
    reverse rollback are present.
11. Content safety scan: no absolute local paths, credential values, tokens, cookies,
    MFA factors/recovery material, real email addresses, real phone numbers, raw
    source/customer rows, message bodies, attachments, or raw probe responses.

U1–U3 documentation is complete only when these deterministic checks pass.
Configured U2 evidence still requires BP01–BP18/AP01–AP18, and configured U3 evidence
requires every allowed role to run the disposable desktop-browser smoke against the
exact fixture totals. Neither is claimed by this docs-only change. Live configuration
remains a separate approved manual change.
