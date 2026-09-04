# Paryatech CRM workspace runbook

**Status:** U1 manual-configuration contract. This document defines a reproducible
metadata recipe; it does not authorize or record a live production change.

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
- U1 creates metadata and records policy decisions only. Roles and permissions are
  U2; views and workflows are U3; import is U4; guarded mutations are U5/U6; mailbox
  synchronization is U8.

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

**No-test exception:** U1 changes documentation and a manual workspace recipe only;
it changes no executable behavior. Adding an automated application test would not
exercise Twenty Settings. Replacement verification is therefore mandatory:

1. `git diff --check -- docs/operations/paryatech-crm-runbook.md`
2. Heading and identifier consistency: one H1; unique N01–N05, C01–C09, and
   REL01–REL19 declarations; every relation reference targets a declared object.
3. Recipe completeness: scope, fixed vocabularies, native/custom field inventories,
   relation inventory, constraints, policy gate, creation order, rollback, recreate,
   and no-test exception are all present.
4. Content safety scan: no absolute local paths, credential assignments, secret
   values, real email addresses other than the approved shared mailbox label, real
   phone numbers, or source-row/customer content.

U1 is complete only when all replacement checks pass. Live configuration remains a
separate approved manual change.
