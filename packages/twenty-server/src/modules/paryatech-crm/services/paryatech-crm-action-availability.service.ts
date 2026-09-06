import { Injectable } from '@nestjs/common';

import { AgencyContactControlService } from 'src/modules/paryatech-crm/services/agency-contact-control.service';
import { canActorResumeSharedException } from 'src/modules/paryatech-crm/services/guarded-transition.helpers';
import {
  PARYATECH_CRM_ACTION,
  type ParyatechCrmAction,
} from 'src/modules/paryatech-crm/types/agency-contact-control.type';
import {
  PARYATECH_ROLE,
  ParyatechTransitionStore,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

type AvailableActionsParams = {
  workspaceId: string;
  userWorkspaceId: string;
  actorWorkspaceMemberId: string;
  objectName:
    | 'company'
    | 'person'
    | 'opportunity'
    | 'commercialAgreement'
    | 'supportCase'
    | 'sharedException';
  recordId: string;
};

const OPEN_SUPPORT_CASE_STATUSES = [
  'New',
  'Assigned',
  'In Progress',
  'Waiting on Agency',
  'Waiting Internal',
] as const;

@Injectable()
export class ParyatechCrmActionAvailabilityService {
  constructor(
    private readonly store: ParyatechTransitionStore,
    private readonly agencyContactControlService: AgencyContactControlService,
  ) {}

  async getAvailableActions(
    params: AvailableActionsParams,
  ): Promise<ParyatechCrmAction[]> {
    const actorRole = await this.store.getActorRole(params);
    const roleLabel = actorRole.label;
    const u5Actions =
      params.objectName === 'company'
        ? await this.agencyContactControlService.getAvailableActions({
            workspaceId: params.workspaceId,
            userWorkspaceId: params.userWorkspaceId,
            actorWorkspaceMemberId: params.actorWorkspaceMemberId,
            agencyId: params.recordId,
          })
        : [];

    return this.store.transact(
      {
        workspaceId: params.workspaceId,
        objectName: params.objectName,
        recordId: params.recordId,
      },
      async ({ record }) => {
        if (!record) {
          return [];
        }
        const actions: ParyatechCrmAction[] = [...u5Actions];

        if (
          (params.objectName === 'company' || params.objectName === 'person') &&
          roleLabel === PARYATECH_ROLE.LEGAL_COMPLIANCE &&
          record.isSuppressed === true &&
          typeof record.suppressionReason === 'string' &&
          record.suppressionReason.trim().length > 0 &&
          record.suppressedAt instanceof Date
        ) {
          actions.push(PARYATECH_CRM_ACTION.CLEAR_SUPPRESSION);
        }
        if (
          (params.objectName === 'company' || params.objectName === 'person') &&
          this.isOperatorOrCommercial(roleLabel)
        ) {
          actions.push(PARYATECH_CRM_ACTION.RECORD_SUPPORT_RECEIPT);
        }
        if (
          params.objectName === 'opportunity' &&
          (roleLabel === PARYATECH_ROLE.COMMERCIAL_SENSITIVE ||
            (roleLabel === PARYATECH_ROLE.OPERATOR &&
              record.ownerId === params.actorWorkspaceMemberId))
        ) {
          actions.push(PARYATECH_CRM_ACTION.TRANSITION_OPPORTUNITY);
        }
        if (
          params.objectName === 'commercialAgreement' &&
          roleLabel === PARYATECH_ROLE.COMMERCIAL_SENSITIVE
        ) {
          actions.push(PARYATECH_CRM_ACTION.TRANSITION_AGREEMENT);
        }
        if (
          params.objectName === 'supportCase' &&
          this.isOperatorOrCommercial(roleLabel)
        ) {
          actions.push(PARYATECH_CRM_ACTION.RECORD_SUPPORT_RECEIPT);
          if (record.ownerId === params.actorWorkspaceMemberId) {
            if (
              OPEN_SUPPORT_CASE_STATUSES.includes(
                record.status as (typeof OPEN_SUPPORT_CASE_STATUSES)[number],
              )
            ) {
              actions.push(PARYATECH_CRM_ACTION.RECORD_SUBSTANTIVE_RESPONSE);
            }
            actions.push(PARYATECH_CRM_ACTION.TRANSITION_SUPPORT_CASE);
          }
        }
        if (
          params.objectName === 'sharedException' &&
          record.status === 'Resolved' &&
          record.resumedAt == null &&
          record.ownerId === params.actorWorkspaceMemberId &&
          canActorResumeSharedException(actorRole, record.capability)
        ) {
          actions.push(PARYATECH_CRM_ACTION.RESUME_SHARED_EXCEPTION);
        }

        return actions;
      },
    );
  }

  private isOperatorOrCommercial(roleLabel: string) {
    return (
      roleLabel === PARYATECH_ROLE.OPERATOR ||
      roleLabel === PARYATECH_ROLE.COMMERCIAL_SENSITIVE
    );
  }
}
