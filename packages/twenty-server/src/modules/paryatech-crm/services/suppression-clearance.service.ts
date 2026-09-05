import { Injectable } from '@nestjs/common';

import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import {
  assertActorRole,
  assertReasonAndEvidence,
  assertRecord,
  isNonEmptyText,
  toTransitionResult,
} from 'src/modules/paryatech-crm/services/guarded-transition.helpers';
import {
  type ClearSuppressionParams,
  PARYATECH_ROLE,
  ParyatechTransitionStore,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

@Injectable()
export class SuppressionClearanceService {
  constructor(private readonly store: ParyatechTransitionStore) {}

  async clear(params: ClearSuppressionParams) {
    assertReasonAndEvidence(params);

    return this.store.transact(
      {
        workspaceId: params.workspaceId,
        objectName: params.targetObject,
        recordId: params.targetId,
      },
      async (transaction) => {
        const record = assertRecord(
          transaction.record,
          params.targetObject,
          params.targetId,
        );
        assertActorRole(await this.store.getActorRoleLabel(params), [
          PARYATECH_ROLE.LEGAL_COMPLIANCE,
        ]);
        if (
          record.isSuppressed !== true ||
          !isNonEmptyText(record.suppressionReason) ||
          !(record.suppressedAt instanceof Date)
        ) {
          throw new ParyatechCrmException(
            'Suppression is not active with retained original evidence',
            ParyatechCrmExceptionCode.TRANSITION_NOT_ALLOWED,
          );
        }

        await transaction.update(params.targetObject, params.targetId, {
          isSuppressed: false,
          suppressionClearedAt: params.now ?? new Date(),
          suppressionClearanceReason: `${params.reason.trim()} Evidence: ${params.evidence.trim()}`,
          ...(params.targetObject === 'company'
            ? { agencyDisposition: 'Eligible' }
            : {}),
        });

        return toTransitionResult(
          params.targetId,
          params.targetObject,
          'Cleared',
        );
      },
    );
  }
}
