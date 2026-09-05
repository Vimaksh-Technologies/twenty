import { type MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';

import { CustomException } from 'src/utils/custom-exception';

export const ParyatechCrmExceptionCode = {
  AGENCY_ALREADY_CLAIMED: 'AGENCY_ALREADY_CLAIMED',
  AGENCY_NOT_FOUND: 'AGENCY_NOT_FOUND',
  CLAIM_NOT_ACTIVE: 'CLAIM_NOT_ACTIVE',
  CLAIM_OWNED_BY_ANOTHER_OPERATOR: 'CLAIM_OWNED_BY_ANOTHER_OPERATOR',
  COMMERCIAL_EVIDENCE_INVALID: 'COMMERCIAL_EVIDENCE_INVALID',
  CONTACT_NOT_FOUND: 'CONTACT_NOT_FOUND',
  DUPLICATE_OUTREACH: 'DUPLICATE_OUTREACH',
  EVIDENCE_REQUIRED: 'EVIDENCE_REQUIRED',
  EXCEPTION_GATE_NOT_PASSED: 'EXCEPTION_GATE_NOT_PASSED',
  INVALID_OUTREACH_RECONCILIATION: 'INVALID_OUTREACH_RECONCILIATION',
  INVALID_RESERVATION_POLICY: 'INVALID_RESERVATION_POLICY',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RECORD_NOT_FOUND: 'RECORD_NOT_FOUND',
  RECEIPT_CONFLICT: 'RECEIPT_CONFLICT',
  STATE_CHANGED: 'STATE_CHANGED',
  SUPPORT_MATCH_INVALID: 'SUPPORT_MATCH_INVALID',
  TRANSITION_NOT_ALLOWED: 'TRANSITION_NOT_ALLOWED',
  PROTECTED_FIELD_WRITE: 'PROTECTED_FIELD_WRITE',
  SCHEMA_NOT_CONFIGURED: 'SCHEMA_NOT_CONFIGURED',
  SUPPRESSED_OUTREACH: 'SUPPRESSED_OUTREACH',
} as const;

export type ParyatechCrmExceptionCode =
  (typeof ParyatechCrmExceptionCode)[keyof typeof ParyatechCrmExceptionCode];

const FRIENDLY_MESSAGES: Record<ParyatechCrmExceptionCode, MessageDescriptor> =
  {
    AGENCY_ALREADY_CLAIMED: msg`This Agency is already reserved. Refresh the record and choose another Agency.`,
    AGENCY_NOT_FOUND: msg`This Agency no longer exists. Refresh the record.`,
    CLAIM_NOT_ACTIVE: msg`The reservation is no longer active. Refresh the record and claim it again.`,
    CLAIM_OWNED_BY_ANOTHER_OPERATOR: msg`Another operator owns this reservation. Ask an administrator to transfer it.`,
    COMMERCIAL_EVIDENCE_INVALID: msg`The commercial evidence cannot support this change. Reconcile the Agreement evidence and retry.`,
    CONTACT_NOT_FOUND: msg`This Contact no longer exists. Refresh the Agency and choose another Contact.`,
    DUPLICATE_OUTREACH: msg`This channel event was already recorded. Reconcile the existing event instead of submitting it again.`,
    EVIDENCE_REQUIRED: msg`Reason and retained evidence are required. Complete both fields before retrying.`,
    EXCEPTION_GATE_NOT_PASSED: msg`The affected gate has not passed. Resolve the gate and retain its evidence before resuming work.`,
    INVALID_OUTREACH_RECONCILIATION: msg`This channel outcome cannot replace the recorded outcome. Review the existing evidence.`,
    INVALID_RESERVATION_POLICY: msg`The CRM reservation policy is missing or invalid. Ask an administrator to correct it.`,
    PERMISSION_DENIED: msg`Your role cannot perform this action. Ask an administrator to review your permissions.`,
    PROTECTED_FIELD_WRITE: msg`Use the guarded CRM action instead of editing this protected field directly.`,
    SCHEMA_NOT_CONFIGURED: msg`Required CRM fields are not configured. Ask an administrator to complete the CRM metadata setup.`,
    RECEIPT_CONFLICT: msg`This receipt key is already bound to different source evidence. Reconcile the source receipt instead of retrying.`,
    RECORD_NOT_FOUND: msg`This record no longer exists. Refresh the record and retry.`,
    STATE_CHANGED: msg`This record changed after the action opened. Refresh it and choose an action for its current state.`,
    SUPPORT_MATCH_INVALID: msg`The selected Case is not an open verified match. Choose an open matching Case or create a new Case.`,
    TRANSITION_NOT_ALLOWED: msg`This transition is not allowed from the current state. Use the displayed correction or closure path.`,
    SUPPRESSED_OUTREACH: msg`Outreach is blocked by Agency or Contact suppression. Request approved clearance before retrying.`,
  };

export class ParyatechCrmException extends CustomException<ParyatechCrmExceptionCode> {
  constructor(
    message: string,
    code: ParyatechCrmExceptionCode,
    userFriendlyMessage = FRIENDLY_MESSAGES[code],
  ) {
    super(message, code, { userFriendlyMessage });
  }
}
