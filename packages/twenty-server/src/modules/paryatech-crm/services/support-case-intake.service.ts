import { Injectable } from '@nestjs/common';

import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import {
  addBusinessDays,
  addBusinessMinutes,
  parseBusinessCalendar,
} from 'src/modules/paryatech-crm/services/agency-contact-control-calendar';
import {
  assertActorRole,
  assertExpectedState,
  assertReasonAndEvidence,
  assertRecord,
  isNonEmptyText,
  requireDate,
  requireText,
  toTransitionResult,
} from 'src/modules/paryatech-crm/services/guarded-transition.helpers';
import { snapshotGuardedActionState } from 'src/modules/paryatech-crm/services/guarded-action-receipt.service';
import { PARYATECH_CRM_ACTION } from 'src/modules/paryatech-crm/types/agency-contact-control.type';
import { type GuardedActionIdentity } from 'src/modules/paryatech-crm/types/guarded-action-receipt.type';
import {
  PARYATECH_ROLE,
  type ParyatechRecord,
  ParyatechTransitionStore,
  type RecordSubstantiveResponseParams,
  type RecordSupportReceiptParams,
  type SupportPriority,
  type SupportStatus,
  type TransitionSupportCaseParams,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

const HUMAN_SUPPORT_ACTOR_ROLES = [
  PARYATECH_ROLE.OPERATOR,
  PARYATECH_ROLE.COMMERCIAL_SENSITIVE,
] as const;
const OPEN_CASE_STATUSES: SupportStatus[] = [
  'New',
  'Assigned',
  'In Progress',
  'Waiting on Agency',
  'Waiting Internal',
];
const CASE_TRANSITIONS: Record<SupportStatus, readonly SupportStatus[]> = {
  New: ['Assigned', 'In Progress', 'Closed'],
  Assigned: ['In Progress', 'Closed'],
  'In Progress': [
    'Assigned',
    'Waiting on Agency',
    'Waiting Internal',
    'Resolved',
    'Closed',
  ],
  'Waiting on Agency': ['In Progress', 'Resolved', 'Closed'],
  'Waiting Internal': ['In Progress', 'Resolved', 'Closed'],
  Resolved: ['Closed', 'In Progress'],
  Closed: ['In Progress'],
};

@Injectable()
export class SupportCaseIntakeService {
  constructor(private readonly store: ParyatechTransitionStore) {}

  async recordReceipt(params: RecordSupportReceiptParams) {
    assertReasonAndEvidence(params);
    this.assertReceiptFields(params);
    const receiptKey = params.receiptKey.trim();

    return this.store.transact(
      {
        workspaceId: params.workspaceId,
        objectName: 'supportReceipt',
        lockKey: `support-receipt:${receiptKey}`,
      },
      async (transaction) => {
        await this.assertSupportActor(params);
        const existingReceipt = await transaction.findOne('supportReceipt', {
          receiptKey,
        });
        if (existingReceipt) {
          this.assertMatchingReplay(existingReceipt, params);
          const supportCase = await transaction.getRequired(
            'supportCase',
            requireText(existingReceipt.caseId, 'supportReceipt.case'),
          );
          const result = {
            ...toTransitionResult(
              supportCase.id,
              'supportCase',
              String(supportCase.status),
            ),
            replayed: true,
          };
          await transaction.appendGuardedActionReceipt({
            action: PARYATECH_CRM_ACTION.RECORD_SUPPORT_RECEIPT,
            actor: params,
            reason: params.reason,
            evidenceReference: params.evidence,
            occurredAt: params.now ?? new Date(),
            objectName: 'supportCase',
            recordId: supportCase.id,
            ownerId: this.recordOwnerId(supportCase),
            priorState: snapshotGuardedActionState({
              supportReceipt: existingReceipt,
              supportCase,
            }),
            resultState: snapshotGuardedActionState({
              supportReceipt: existingReceipt,
              supportCase,
            }),
          });

          return result;
        }

        const supportCase = params.verifiedOpenCaseId
          ? await this.requireVerifiedOpenCase(transaction, params)
          : await this.createCase(
              transaction,
              params,
              await this.resolveCaseOwner(transaction, params),
            );
        const createdReceipt = await transaction.create('supportReceipt', {
          receiptKey: params.receiptKey.trim(),
          channel: params.channel,
          providerOrSourceId: params.providerOrSourceId.trim(),
          sourceReceivedAt: params.sourceReceivedAt,
          payloadHash: params.payloadHash.trim(),
          caseId: supportCase.id,
          receiptDisposition: 'Support',
        });
        const result = {
          ...toTransitionResult(
            supportCase.id,
            'supportCase',
            String(supportCase.status),
          ),
          replayed: false,
        };
        await transaction.appendGuardedActionReceipt({
          action: PARYATECH_CRM_ACTION.RECORD_SUPPORT_RECEIPT,
          actor: params,
          reason: params.reason,
          evidenceReference: params.evidence,
          occurredAt: params.now ?? new Date(),
          objectName: 'supportCase',
          recordId: supportCase.id,
          ownerId: this.recordOwnerId(supportCase),
          priorState: snapshotGuardedActionState({
            supportReceipt: null,
            supportCase: null,
          }),
          resultState: snapshotGuardedActionState({
            supportReceipt: createdReceipt,
            supportCase,
          }),
        });

        return result;
      },
    );
  }

  async recordSubstantiveResponse(params: RecordSubstantiveResponseParams) {
    assertReasonAndEvidence(params);
    requireText(params.responseSummary, 'responseSummary');
    requireDate(params.respondedAt, 'respondedAt');

    return this.store.transact(
      {
        workspaceId: params.workspaceId,
        objectName: 'supportCase',
        recordId: params.supportCaseId,
      },
      async (transaction) => {
        await this.assertSupportActor(params);
        const supportCase = assertRecord(
          transaction.record,
          'supportCase',
          params.supportCaseId,
        );
        const sourceReceivedAt = requireDate(
          supportCase.sourceReceivedAt,
          'sourceReceivedAt',
        );
        if (params.respondedAt < sourceReceivedAt) {
          throw new ParyatechCrmException(
            'A substantive response cannot predate the source receipt',
            ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
          );
        }
        this.assertAssignedOwner(supportCase, params.actorWorkspaceMemberId);
        if (!OPEN_CASE_STATUSES.includes(supportCase.status as SupportStatus)) {
          throw this.transitionNotAllowed(
            `Cannot respond substantively to ${String(supportCase.status)}`,
          );
        }
        const priorState = snapshotGuardedActionState(supportCase);
        const targetStatus =
          supportCase.status === 'New' || supportCase.status === 'Assigned'
            ? 'In Progress'
            : String(supportCase.status);
        const updatedSupportCase =
          supportCase.firstSubstantiveResponseAt == null
            ? await transaction.update('supportCase', supportCase.id, {
                firstSubstantiveResponseAt: params.respondedAt,
                status: targetStatus,
              })
            : supportCase;
        await transaction.appendGuardedActionReceipt({
          action: PARYATECH_CRM_ACTION.RECORD_SUBSTANTIVE_RESPONSE,
          actor: params,
          reason: params.reason,
          evidenceReference: params.evidence,
          occurredAt: params.now ?? new Date(),
          objectName: 'supportCase',
          recordId: supportCase.id,
          ownerId: params.actorWorkspaceMemberId,
          priorState,
          resultState: snapshotGuardedActionState(updatedSupportCase),
          responseSummary: params.responseSummary,
        });

        return toTransitionResult(supportCase.id, 'supportCase', targetStatus);
      },
    );
  }

  async transitionCase(params: TransitionSupportCaseParams) {
    assertReasonAndEvidence(params);

    return this.store.transact(
      {
        workspaceId: params.workspaceId,
        objectName: 'supportCase',
        recordId: params.supportCaseId,
      },
      async (transaction) => {
        await this.assertSupportActor(params);
        const supportCase = assertRecord(
          transaction.record,
          'supportCase',
          params.supportCaseId,
        );
        this.assertAssignedOwner(supportCase, params.actorWorkspaceMemberId);
        assertExpectedState(supportCase.status, params.expectedStatus);
        const allowed = CASE_TRANSITIONS[params.expectedStatus];
        if (!allowed.includes(params.targetStatus)) {
          throw this.transitionNotAllowed(
            `Case transition ${params.expectedStatus} -> ${params.targetStatus} is not listed`,
          );
        }
        const priorState = snapshotGuardedActionState(supportCase);

        const closesAsClassification =
          params.targetStatus === 'Closed' &&
          ['Duplicate', 'Non-support'].includes(params.disposition);
        const requiresResolution =
          closesAsClassification ||
          params.targetStatus === 'Resolved' ||
          params.targetStatus === 'Closed' ||
          (['Resolved', 'Closed'].includes(params.expectedStatus) &&
            params.targetStatus === 'In Progress');
        const resolution = requiresResolution
          ? requireText(params.resolution, 'resolution')
          : params.resolution;
        await transaction.update('supportCase', supportCase.id, {
          status: params.targetStatus,
          disposition: params.disposition,
          ...(isNonEmptyText(resolution)
            ? { resolution: resolution.trim() }
            : {}),
        });

        if (closesAsClassification) {
          const receipts = await this.receiptsForCase(
            transaction,
            supportCase.id,
          );
          await Promise.all(
            receipts.map((receipt) =>
              transaction.update('supportReceipt', receipt.id, {
                receiptDisposition: params.disposition,
              }),
            ),
          );
        }
        const updatedSupportCase = await transaction.getRequired(
          'supportCase',
          supportCase.id,
        );
        await transaction.appendGuardedActionReceipt({
          action: PARYATECH_CRM_ACTION.TRANSITION_SUPPORT_CASE,
          actor: params,
          reason: params.reason,
          evidenceReference: params.evidence,
          occurredAt: params.now ?? new Date(),
          objectName: 'supportCase',
          recordId: supportCase.id,
          ownerId: params.actorWorkspaceMemberId,
          priorState,
          resultState: snapshotGuardedActionState(updatedSupportCase),
        });

        return toTransitionResult(
          supportCase.id,
          'supportCase',
          params.targetStatus,
        );
      },
    );
  }

  private async assertSupportActor(
    params: GuardedActionIdentity & { workspaceId: string },
  ) {
    assertActorRole(
      await this.store.getActorRoleLabel(params),
      params.apiKeyId === undefined
        ? HUMAN_SUPPORT_ACTOR_ROLES
        : [PARYATECH_ROLE.SUPPORT_INTAKE],
    );
  }

  private assertReceiptFields(params: RecordSupportReceiptParams) {
    requireText(params.receiptKey, 'receiptKey');
    const providerOrSourceId = requireText(
      params.providerOrSourceId,
      'providerOrSourceId',
    );
    const channel = requireText(params.channel, 'channel');
    if (params.receiptKey.trim() !== `${channel}:${providerOrSourceId}`) {
      throw this.receiptConflict(
        'Receipt key must match the immutable channel and source identifier',
      );
    }
    requireText(params.payloadHash, 'payloadHash');
    requireText(params.subject, 'subject');
    requireText(params.summary, 'summary');
    requireDate(params.sourceReceivedAt, 'sourceReceivedAt');
  }

  private assertMatchingReplay(
    existingReceipt: ParyatechRecord,
    params: RecordSupportReceiptParams,
  ) {
    const existingSourceReceivedAt = requireDate(
      existingReceipt.sourceReceivedAt,
      'supportReceipt.sourceReceivedAt',
    );
    const caseMatches =
      params.verifiedOpenCaseId == null ||
      existingReceipt.caseId === params.verifiedOpenCaseId;
    if (
      existingReceipt.channel !== params.channel ||
      existingReceipt.providerOrSourceId !== params.providerOrSourceId.trim() ||
      existingReceipt.payloadHash !== params.payloadHash.trim() ||
      existingSourceReceivedAt.getTime() !==
        params.sourceReceivedAt.getTime() ||
      !caseMatches
    ) {
      throw this.receiptConflict(
        'Receipt key is already bound to different immutable source evidence',
      );
    }
  }

  private async requireVerifiedOpenCase(
    transaction: {
      getRequired: (objectName: string, id: string) => Promise<ParyatechRecord>;
    },
    params: RecordSupportReceiptParams,
  ) {
    if (!isNonEmptyText(params.verifiedMatchEvidence)) {
      throw new ParyatechCrmException(
        'A caller-verified Case match requires retained match evidence',
        ParyatechCrmExceptionCode.SUPPORT_MATCH_INVALID,
      );
    }
    const supportCase = await transaction.getRequired(
      'supportCase',
      params.verifiedOpenCaseId as string,
    );
    if (!OPEN_CASE_STATUSES.includes(supportCase.status as SupportStatus)) {
      throw new ParyatechCrmException(
        'Verified Case match is not open',
        ParyatechCrmExceptionCode.SUPPORT_MATCH_INVALID,
      );
    }
    return supportCase;
  }

  private async createCase(
    transaction: {
      findOne: (
        objectName: string,
        where: Record<string, unknown>,
      ) => Promise<ParyatechRecord | null>;
      getRequired: (objectName: string, id: string) => Promise<ParyatechRecord>;
      create: (
        objectName: string,
        data: Record<string, unknown>,
      ) => Promise<ParyatechRecord>;
    },
    params: RecordSupportReceiptParams,
    ownerId: string,
  ) {
    const policy = await transaction.findOne('crmOperatingPolicy', {
      active: true,
    });
    const calendar = parseBusinessCalendar(policy?.businessCalendar);
    if (!calendar) {
      throw new ParyatechCrmException(
        'Active CRM business calendar is missing or invalid',
        ParyatechCrmExceptionCode.INVALID_RESERVATION_POLICY,
      );
    }
    return transaction.create('supportCase', {
      caseReference: `case:${params.receiptKey}`,
      subject: params.subject.trim(),
      summary: params.summary.trim(),
      channel: params.channel,
      priority: params.priority,
      sourceReceivedAt: params.sourceReceivedAt,
      responseTargetAt: this.responseTargetAt(
        params.sourceReceivedAt,
        params.priority,
        calendar,
      ),
      ownerId,
      status: 'New',
      escalation: null,
      disposition: 'Support',
      firstSubstantiveResponseAt: null,
      resolution: null,
      agencyId: params.agencyId ?? null,
      contactId: params.contactId ?? null,
      productId: params.productId ?? null,
      agreementId: params.agreementId ?? null,
    });
  }

  private async resolveCaseOwner(
    transaction: {
      getRequired: (objectName: string, id: string) => Promise<ParyatechRecord>;
    },
    params: RecordSupportReceiptParams,
  ): Promise<string> {
    if (params.apiKeyId === undefined) {
      return params.actorWorkspaceMemberId;
    }
    if (params.agencyId === undefined) {
      throw new ParyatechCrmException(
        'API support intake requires an Agency with a server-owned record owner',
        ParyatechCrmExceptionCode.PERMISSION_DENIED,
      );
    }
    const agency = await transaction.getRequired('company', params.agencyId);

    return requireText(agency.recordOwnerId, 'company.recordOwner');
  }

  private recordOwnerId(record: ParyatechRecord): string | null {
    return typeof record.ownerId === 'string' ? record.ownerId : null;
  }

  private responseTargetAt(
    sourceReceivedAt: Date,
    priority: SupportPriority,
    calendar: NonNullable<ReturnType<typeof parseBusinessCalendar>>,
  ) {
    switch (priority) {
      case 'Urgent':
        return addBusinessMinutes(sourceReceivedAt, 60, calendar);
      case 'High':
        return addBusinessMinutes(sourceReceivedAt, 4 * 60, calendar);
      case 'Normal':
        return addBusinessDays(sourceReceivedAt, 1, calendar);
      case 'Low':
        return addBusinessDays(sourceReceivedAt, 2, calendar);
    }
  }

  private assertAssignedOwner(
    supportCase: ParyatechRecord,
    actorWorkspaceMemberId: string,
  ) {
    if (supportCase.ownerId !== actorWorkspaceMemberId) {
      throw new ParyatechCrmException(
        'Only the assigned Case owner may perform this action',
        ParyatechCrmExceptionCode.PERMISSION_DENIED,
      );
    }
  }

  private async receiptsForCase(
    transaction: {
      findMany: (
        objectName: string,
        where: Record<string, unknown>,
      ) => Promise<ParyatechRecord[]>;
    },
    caseId: string,
  ) {
    return transaction.findMany('supportReceipt', { caseId });
  }

  private transitionNotAllowed(message: string) {
    return new ParyatechCrmException(
      message,
      ParyatechCrmExceptionCode.TRANSITION_NOT_ALLOWED,
    );
  }

  private receiptConflict(message: string) {
    return new ParyatechCrmException(
      message,
      ParyatechCrmExceptionCode.RECEIPT_CONFLICT,
    );
  }
}
