import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Field, Mutation, ObjectType, Query } from '@nestjs/graphql';

import { isDefined } from 'twenty-shared/utils';
import { GraphQLJSON } from 'graphql-type-json';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { type ApiKeyEntity } from 'src/engine/core-modules/api-key/api-key.entity';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthApiKey } from 'src/engine/decorators/auth/auth-api-key.decorator';
import { AuthUser } from 'src/engine/decorators/auth/auth-user.decorator';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { ApplyCommercialCutoverAgreementInput } from 'src/modules/paryatech-crm/dtos/apply-commercial-cutover-agreement.input';
import { CommercialCutoverResultDTO } from 'src/modules/paryatech-crm/dtos/commercial-cutover-result.dto';
import { ClaimAgencyInput } from 'src/modules/paryatech-crm/dtos/claim-agency.input';
import { ClearSuppressionInput } from 'src/modules/paryatech-crm/dtos/clear-suppression.input';
import { RecordOutreachOutcomeInput } from 'src/modules/paryatech-crm/dtos/record-outreach-outcome.input';
import { RecordSubstantiveResponseInput } from 'src/modules/paryatech-crm/dtos/record-substantive-response.input';
import { RecordSupportReceiptInput } from 'src/modules/paryatech-crm/dtos/record-support-receipt.input';
import { ReleaseAgencyInput } from 'src/modules/paryatech-crm/dtos/release-agency.input';
import { ResumeSharedExceptionInput } from 'src/modules/paryatech-crm/dtos/resume-shared-exception.input';
import { TransitionAgreementInput } from 'src/modules/paryatech-crm/dtos/transition-agreement.input';
import { TransitionOpportunityInput } from 'src/modules/paryatech-crm/dtos/transition-opportunity.input';
import { TransitionSupportCaseInput } from 'src/modules/paryatech-crm/dtos/transition-support-case.input';
import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { AgencyContactControlService } from 'src/modules/paryatech-crm/services/agency-contact-control.service';
import { AgreementTransitionService } from 'src/modules/paryatech-crm/services/agreement-transition.service';
import { CommercialCutoverService } from 'src/modules/paryatech-crm/services/commercial-cutover.service';
import { OpportunityTransitionService } from 'src/modules/paryatech-crm/services/opportunity-transition.service';
import { ParyatechCrmActionAvailabilityService } from 'src/modules/paryatech-crm/services/paryatech-crm-action-availability.service';
import { SharedExceptionService } from 'src/modules/paryatech-crm/services/shared-exception.service';
import { SupportCaseIntakeService } from 'src/modules/paryatech-crm/services/support-case-intake.service';
import { SuppressionClearanceService } from 'src/modules/paryatech-crm/services/suppression-clearance.service';
import {
  type AgencyActionResult,
  type ParyatechCrmAction,
} from 'src/modules/paryatech-crm/types/agency-contact-control.type';
import { type GuardedActionIdentity } from 'src/modules/paryatech-crm/types/guarded-action-receipt.type';
import { type GuardedTransitionResult } from 'src/modules/paryatech-crm/types/paryatech-transition.type';

@ObjectType('ParyatechCrmActionResult')
export class ParyatechCrmActionResultDTO implements AgencyActionResult {
  @Field(() => UUIDScalarType)
  agencyId: string;

  @Field(() => String)
  agencyLifecycle: string;

  @Field(() => String, { nullable: true })
  reservationStatus: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  reservationClaimantId: string | null;

  @Field(() => Date, { nullable: true })
  reservationExpiresAt: Date | null;

  @Field(() => UUIDScalarType, { nullable: true })
  recordOwnerId: string | null;

  @Field(() => Date, { nullable: true })
  pendingExpiresAt: Date | null;

  @Field(() => Date, { nullable: true })
  firstAttemptedAt: Date | null;

  @Field(() => Date, { nullable: true })
  firstProviderAcceptedAt: Date | null;

  @Field(() => Date, { nullable: true })
  firstPendingUnknownAt: Date | null;

  @Field(() => Date, { nullable: true })
  firstContactedAt: Date | null;

  @Field(() => Date, { nullable: true })
  firstEngagedAt: Date | null;
}

@ObjectType('ParyatechCrmTransitionResult')
export class ParyatechCrmTransitionResultDTO implements GuardedTransitionResult {
  @Field(() => UUIDScalarType)
  recordId: string;

  @Field(() => String)
  objectName: string;

  @Field(() => String)
  state: string;

  @Field(() => String, { nullable: true })
  correction: string | null;

  @Field(() => Boolean, { nullable: true })
  replayed?: boolean;
}

@ObjectType('ParyatechCrmAvailableAction')
export class ParyatechCrmAvailableActionDTO {
  @Field(() => String)
  action: ParyatechCrmAction;

  @Field(() => Boolean)
  requiresReason: boolean;

  @Field(() => Boolean)
  requiresEvidence: boolean;
}

@MetadataResolver()
@UsePipes(ResolverValidationPipe)
@UseFilters(AuthGraphqlApiExceptionFilter)
@UseGuards(WorkspaceAuthGuard, NoPermissionGuard)
export class ParyatechCrmResolver {
  constructor(
    private readonly agencyContactControlService: AgencyContactControlService,
    private readonly commercialCutoverService: CommercialCutoverService,
    private readonly opportunityTransitionService: OpportunityTransitionService,
    private readonly agreementTransitionService: AgreementTransitionService,
    private readonly supportCaseIntakeService: SupportCaseIntakeService,
    private readonly suppressionClearanceService: SuppressionClearanceService,
    private readonly sharedExceptionService: SharedExceptionService,
    private readonly actionAvailabilityService: ParyatechCrmActionAvailabilityService,
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  @Query(() => [ParyatechCrmAvailableActionDTO])
  async getParyatechCrmAvailableActions(
    @Args('objectName', { type: () => String })
    objectName:
      | 'company'
      | 'person'
      | 'opportunity'
      | 'commercialAgreement'
      | 'supportCase'
      | 'sharedException',
    @Args('recordId', { type: () => UUIDScalarType }) recordId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: AuthContextUser,
  ): Promise<ParyatechCrmAvailableActionDTO[]> {
    const actorWorkspaceMemberId = await this.getWorkspaceMemberId(
      workspace.id,
      user.id,
    );
    const actions = await this.actionAvailabilityService.getAvailableActions({
      workspaceId: workspace.id,
      userWorkspaceId,
      actorWorkspaceMemberId,
      objectName,
      recordId,
    });

    return actions.map((action) => ({
      action,
      requiresReason: true,
      requiresEvidence: true,
    }));
  }

  @Query(() => GraphQLJSON, { nullable: true })
  async inspectCommercialCutoverAgreement(
    @Args('sourceCommercialId', { type: () => String })
    sourceCommercialId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthApiKey() apiKey?: ApiKeyEntity,
  ) {
    const authenticatedApiKey = this.requireCommercialCutoverApiKey(apiKey);
    return this.commercialCutoverService.inspectAgreement({
      apiKeyId: authenticatedApiKey.id,
      sourceCommercialId,
      workspaceId: workspace.id,
    });
  }

  @Query(() => GraphQLJSON, { nullable: true })
  async inspectCommercialCutoverReceipt(
    @Args('sourceCommercialId', { type: () => String })
    sourceCommercialId: string,
    @Args('idempotencyKey', { type: () => String })
    idempotencyKey: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthApiKey() apiKey?: ApiKeyEntity,
  ) {
    const authenticatedApiKey = this.requireCommercialCutoverApiKey(apiKey);
    return this.commercialCutoverService.inspectReceipt({
      apiKeyId: authenticatedApiKey.id,
      idempotencyKey,
      sourceCommercialId,
      workspaceId: workspace.id,
    });
  }

  @Mutation(() => CommercialCutoverResultDTO)
  async applyCommercialCutoverAgreement(
    @Args('input') input: ApplyCommercialCutoverAgreementInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthApiKey() apiKey?: ApiKeyEntity,
  ) {
    const authenticatedApiKey = this.requireCommercialCutoverApiKey(apiKey);
    return this.commercialCutoverService.applyAgreement({
      apiKeyId: authenticatedApiKey.id,
      workspaceId: workspace.id,
      ...input,
      expectedSnapshotHash: input.expectedSnapshotHash ?? null,
    });
  }

  @Mutation(() => ParyatechCrmActionResultDTO)
  async claimAgency(
    @Args('input') input: ClaimAgencyInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: AuthContextUser,
  ) {
    return this.agencyContactControlService.claimAgency({
      workspaceId: workspace.id,
      userWorkspaceId,
      actorWorkspaceMemberId: await this.getWorkspaceMemberId(
        workspace.id,
        user.id,
      ),
      ...input,
    });
  }

  @Mutation(() => ParyatechCrmActionResultDTO)
  async releaseAgency(
    @Args('input') input: ReleaseAgencyInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: AuthContextUser,
  ) {
    return this.agencyContactControlService.releaseAgency({
      workspaceId: workspace.id,
      userWorkspaceId,
      actorWorkspaceMemberId: await this.getWorkspaceMemberId(
        workspace.id,
        user.id,
      ),
      ...input,
    });
  }

  @Mutation(() => ParyatechCrmActionResultDTO)
  async recordOutreachOutcome(
    @Args('input') input: RecordOutreachOutcomeInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId({ allowUndefined: true })
    userWorkspaceId?: string,
    @AuthUser({ allowUndefined: true }) user?: AuthContextUser,
    @AuthApiKey() apiKey?: ApiKeyEntity,
  ) {
    const actor = await this.resolveGuardedActionIdentity(
      workspace.id,
      userWorkspaceId,
      user,
      apiKey,
    );

    return this.agencyContactControlService.recordOutreachOutcome({
      ...input,
      workspaceId: workspace.id,
      ...actor,
    });
  }

  @Mutation(() => ParyatechCrmTransitionResultDTO)
  async transitionOpportunity(
    @Args('input') input: TransitionOpportunityInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: AuthContextUser,
  ) {
    const actorWorkspaceMemberId = await this.getWorkspaceMemberId(
      workspace.id,
      user.id,
    );
    return this.opportunityTransitionService.transition({
      workspaceId: workspace.id,
      userWorkspaceId,
      actorWorkspaceMemberId,
      ...input,
      trialOwnerId: actorWorkspaceMemberId,
    });
  }

  @Mutation(() => ParyatechCrmTransitionResultDTO)
  async transitionAgreement(
    @Args('input') input: TransitionAgreementInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: AuthContextUser,
  ) {
    const actorWorkspaceMemberId = await this.getWorkspaceMemberId(
      workspace.id,
      user.id,
    );
    return this.agreementTransitionService.transition({
      workspaceId: workspace.id,
      userWorkspaceId,
      actorWorkspaceMemberId,
      ...input,
      evidenceVerifierId: actorWorkspaceMemberId,
      activationConfirmerId: actorWorkspaceMemberId,
    });
  }

  @Mutation(() => ParyatechCrmTransitionResultDTO)
  async recordSupportReceipt(
    @Args('input') input: RecordSupportReceiptInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId({ allowUndefined: true })
    userWorkspaceId?: string,
    @AuthUser({ allowUndefined: true }) user?: AuthContextUser,
    @AuthApiKey() apiKey?: ApiKeyEntity,
  ) {
    const actor = await this.resolveGuardedActionIdentity(
      workspace.id,
      userWorkspaceId,
      user,
      apiKey,
    );

    return this.supportCaseIntakeService.recordReceipt({
      workspaceId: workspace.id,
      ...actor,
      receiptKey: input.receiptKey,
      providerOrSourceId: input.providerOrSourceId,
      payloadHash: input.payloadHash,
      channel: input.channel,
      sourceReceivedAt: input.sourceReceivedAt,
      subject: input.subject,
      summary: input.summary,
      priority: input.priority,
      verifiedOpenCaseId: input.verifiedOpenCaseId,
      verifiedMatchEvidence: input.verifiedMatchEvidence,
      agencyId: input.agencyId,
      contactId: input.contactId,
      productId: input.productId,
      agreementId: input.agreementId,
      reason: input.reason,
      evidence: input.evidence,
    });
  }

  @Mutation(() => ParyatechCrmTransitionResultDTO)
  async clearSuppression(
    @Args('input') input: ClearSuppressionInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: AuthContextUser,
  ) {
    return this.suppressionClearanceService.clear({
      workspaceId: workspace.id,
      userWorkspaceId,
      actorWorkspaceMemberId: await this.getWorkspaceMemberId(
        workspace.id,
        user.id,
      ),
      ...input,
    });
  }

  @Mutation(() => ParyatechCrmTransitionResultDTO)
  async recordSubstantiveResponse(
    @Args('input') input: RecordSubstantiveResponseInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: AuthContextUser,
  ) {
    return this.supportCaseIntakeService.recordSubstantiveResponse({
      workspaceId: workspace.id,
      userWorkspaceId,
      actorWorkspaceMemberId: await this.getWorkspaceMemberId(
        workspace.id,
        user.id,
      ),
      ...input,
    });
  }

  @Mutation(() => ParyatechCrmTransitionResultDTO)
  async transitionSupportCase(
    @Args('input') input: TransitionSupportCaseInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: AuthContextUser,
  ) {
    return this.supportCaseIntakeService.transitionCase({
      workspaceId: workspace.id,
      userWorkspaceId,
      actorWorkspaceMemberId: await this.getWorkspaceMemberId(
        workspace.id,
        user.id,
      ),
      ...input,
    });
  }

  @Mutation(() => ParyatechCrmTransitionResultDTO)
  async resumeSharedException(
    @Args('input') input: ResumeSharedExceptionInput,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: AuthContextUser,
  ) {
    return this.sharedExceptionService.resume({
      workspaceId: workspace.id,
      userWorkspaceId,
      actorWorkspaceMemberId: await this.getWorkspaceMemberId(
        workspace.id,
        user.id,
      ),
      ...input,
    });
  }

  private async resolveGuardedActionIdentity(
    workspaceId: string,
    userWorkspaceId: string | undefined,
    user: AuthContextUser | undefined,
    apiKey: ApiKeyEntity | undefined,
  ): Promise<GuardedActionIdentity> {
    if (isDefined(apiKey) && !isDefined(userWorkspaceId) && !isDefined(user)) {
      return { apiKeyId: apiKey.id };
    }
    if (!isDefined(apiKey) && isDefined(userWorkspaceId) && isDefined(user)) {
      return {
        userWorkspaceId,
        actorWorkspaceMemberId: await this.getWorkspaceMemberId(
          workspaceId,
          user.id,
        ),
      };
    }

    throw new ParyatechCrmException(
      'Guarded CRM action requires exactly one authenticated human or API key actor',
      ParyatechCrmExceptionCode.PERMISSION_DENIED,
    );
  }

  private requireCommercialCutoverApiKey(
    apiKey: ApiKeyEntity | undefined,
  ): ApiKeyEntity {
    if (!isDefined(apiKey)) {
      throw new ParyatechCrmException(
        'Commercial cutover requires a dedicated API key',
        ParyatechCrmExceptionCode.PERMISSION_DENIED,
      );
    }
    return apiKey;
  }
  private async getWorkspaceMemberId(workspaceId: string, userId: string) {
    return this.globalWorkspaceOrmManager.executeInWorkspaceContext(
      async () => {
        const repository = await this.globalWorkspaceOrmManager.getRepository<
          Record<string, unknown>
        >(workspaceId, 'workspaceMember');
        const workspaceMember = await repository.findOne({
          where: { userId },
        });

        if (
          !isDefined(workspaceMember) ||
          typeof workspaceMember.id !== 'string'
        ) {
          throw new ParyatechCrmException(
            `No workspace member found for user ${userId}`,
            ParyatechCrmExceptionCode.PERMISSION_DENIED,
          );
        }

        return workspaceMember.id;
      },
      buildSystemAuthContext(workspaceId),
    );
  }
}
