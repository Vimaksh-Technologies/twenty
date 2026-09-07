import { Injectable } from '@nestjs/common';

import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import {
  assertActorCanResumeSharedException,
  assertReasonAndEvidence,
  assertRecord,
  isNonEmptyText,
  toTransitionResult,
} from 'src/modules/paryatech-crm/services/guarded-transition.helpers';
import { snapshotGuardedActionState } from 'src/modules/paryatech-crm/services/guarded-action-receipt.service';
import { PARYATECH_CRM_ACTION } from 'src/modules/paryatech-crm/types/agency-contact-control.type';
import {
  ParyatechTransitionStore,
  type ResumeSharedExceptionParams,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

@Injectable()
export class SharedExceptionService {
  constructor(private readonly store: ParyatechTransitionStore) {}

  async resume(params: ResumeSharedExceptionParams) {
    assertReasonAndEvidence(params);
    if (!params.gatePassed) {
      throw new ParyatechCrmException(
        'Explicit resume rejected because the affected gate did not pass',
        ParyatechCrmExceptionCode.EXCEPTION_GATE_NOT_PASSED,
      );
    }

    return this.store.transact(
      {
        workspaceId: params.workspaceId,
        objectName: 'sharedException',
        recordId: params.sharedExceptionId,
      },
      async (transaction) => {
        const exception = assertRecord(
          transaction.record,
          'sharedException',
          params.sharedExceptionId,
        );
        assertActorCanResumeSharedException(
          await this.store.getActorRole(params),
          exception.capability,
        );
        if (exception.ownerId !== params.actorWorkspaceMemberId) {
          throw new ParyatechCrmException(
            'Only the assigned exception owner may resume affected work',
            ParyatechCrmExceptionCode.PERMISSION_DENIED,
          );
        }
        const priorState = snapshotGuardedActionState(exception);
        if (exception.resumedAt != null) {
          if (
            exception.status === 'Resolved' &&
            exception.resolvedAt != null &&
            exception.resumeReason === params.reason.trim() &&
            exception.evidence === params.evidence.trim()
          ) {
            const result = {
              ...toTransitionResult(
                exception.id,
                'sharedException',
                'Resolved',
              ),
              replayed: true,
            };
            await transaction.appendGuardedActionReceipt({
              action: PARYATECH_CRM_ACTION.RESUME_SHARED_EXCEPTION,
              actor: params,
              reason: params.reason,
              evidenceReference: params.evidence,
              occurredAt: params.now ?? new Date(),
              objectName: 'sharedException',
              recordId: exception.id,
              ownerId: params.actorWorkspaceMemberId,
              priorState,
              resultState: snapshotGuardedActionState(exception),
            });

            return result;
          }
          throw new ParyatechCrmException(
            'Exception was already resumed with different evidence or reason',
            ParyatechCrmExceptionCode.TRANSITION_NOT_ALLOWED,
          );
        }
        if (
          exception.status !== 'Resolved' ||
          exception.resolvedAt == null ||
          !isNonEmptyText(exception.evidence) ||
          exception.evidence !== params.evidence.trim()
        ) {
          throw new ParyatechCrmException(
            'Exception must be resolved with matching retained gate evidence and not already resumed',
            ParyatechCrmExceptionCode.TRANSITION_NOT_ALLOWED,
          );
        }

        await transaction.update('sharedException', exception.id, {
          resumeReason: params.reason.trim(),
          resumedAt: params.now ?? new Date(),
        });
        const updatedException = await transaction.getRequired(
          'sharedException',
          exception.id,
        );
        await transaction.appendGuardedActionReceipt({
          action: PARYATECH_CRM_ACTION.RESUME_SHARED_EXCEPTION,
          actor: params,
          reason: params.reason,
          evidenceReference: params.evidence,
          occurredAt: params.now ?? new Date(),
          objectName: 'sharedException',
          recordId: exception.id,
          ownerId: params.actorWorkspaceMemberId,
          priorState,
          resultState: snapshotGuardedActionState(updatedException),
        });

        return toTransitionResult(exception.id, 'sharedException', 'Resolved');
      },
    );
  }
}
