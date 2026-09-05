import { UseFilters, UseGuards, UsePipes } from '@nestjs/common';
import { Args, Field, Mutation, ObjectType, Query } from '@nestjs/graphql';

import { isDefined } from 'twenty-shared/utils';

import { MetadataResolver } from 'src/engine/api/graphql/graphql-config/decorators/metadata-resolver.decorator';
import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { AuthGraphqlApiExceptionFilter } from 'src/engine/core-modules/auth/filters/auth-graphql-api-exception.filter';
import { type AuthContextUser } from 'src/engine/core-modules/auth/types/auth-context.type';
import { ResolverValidationPipe } from 'src/engine/core-modules/graphql/pipes/resolver-validation.pipe';
import { WorkspaceEntity } from 'src/engine/core-modules/workspace/workspace.entity';
import { AuthUser } from 'src/engine/decorators/auth/auth-user.decorator';
import { AuthUserWorkspaceId } from 'src/engine/decorators/auth/auth-user-workspace-id.decorator';
import { AuthWorkspace } from 'src/engine/decorators/auth/auth-workspace.decorator';
import { NoPermissionGuard } from 'src/engine/guards/no-permission.guard';
import { WorkspaceAuthGuard } from 'src/engine/guards/workspace-auth.guard';
import { GlobalWorkspaceOrmManager } from 'src/engine/twenty-orm/global-workspace-datasource/global-workspace-orm.manager';
import { buildSystemAuthContext } from 'src/engine/twenty-orm/utils/build-system-auth-context.util';
import { ClaimAgencyInput } from 'src/modules/paryatech-crm/dtos/claim-agency.input';
import { RecordOutreachOutcomeInput } from 'src/modules/paryatech-crm/dtos/record-outreach-outcome.input';
import { ReleaseAgencyInput } from 'src/modules/paryatech-crm/dtos/release-agency.input';
import {
  ParyatechCrmException,
  ParyatechCrmExceptionCode,
} from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { AgencyContactControlService } from 'src/modules/paryatech-crm/services/agency-contact-control.service';
import {
  type AgencyActionResult,
  type ParyatechCrmAction,
} from 'src/modules/paryatech-crm/types/agency-contact-control.type';

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
    private readonly globalWorkspaceOrmManager: GlobalWorkspaceOrmManager,
  ) {}

  @Query(() => [ParyatechCrmAvailableActionDTO])
  async getParyatechCrmAvailableActions(
    @Args('agencyId', { type: () => UUIDScalarType }) agencyId: string,
    @AuthWorkspace() workspace: WorkspaceEntity,
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: AuthContextUser,
  ): Promise<ParyatechCrmAvailableActionDTO[]> {
    const actorWorkspaceMemberId = await this.getWorkspaceMemberId(
      workspace.id,
      user.id,
    );
    const actions = await this.agencyContactControlService.getAvailableActions({
      workspaceId: workspace.id,
      userWorkspaceId,
      actorWorkspaceMemberId,
      agencyId,
    });

    return actions.map((action) => ({
      action,
      requiresReason: true,
      requiresEvidence: true,
    }));
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
    @AuthUserWorkspaceId() userWorkspaceId: string,
    @AuthUser() user: AuthContextUser,
  ) {
    return this.agencyContactControlService.recordOutreachOutcome({
      workspaceId: workspace.id,
      userWorkspaceId,
      actorWorkspaceMemberId: await this.getWorkspaceMemberId(
        workspace.id,
        user.id,
      ),
      ...input,
    });
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
