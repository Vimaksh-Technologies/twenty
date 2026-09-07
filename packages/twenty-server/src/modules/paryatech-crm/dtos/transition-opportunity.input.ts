import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import {
  OPPORTUNITY_STAGES,
  type OpportunityStage,
  type TrialState,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

const TRIAL_STATES = [
  'Approved',
  'Active',
  'Completed',
  'Expired',
  'Cancelled',
];

@InputType()
export class TransitionOpportunityInput {
  @Field(() => UUIDScalarType)
  @IsUUID()
  opportunityId: string;

  @Field(() => String)
  @IsIn(OPPORTUNITY_STAGES)
  expectedStage: OpportunityStage;

  @Field(() => String)
  @IsIn(OPPORTUNITY_STAGES)
  targetStage: OpportunityStage;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsIn(TRIAL_STATES)
  targetTrialState?: TrialState;

  @Field(() => [UUIDScalarType], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  participatingContactIds?: string[];

  @Field(() => [UUIDScalarType], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  productIds?: string[];

  @Field(() => [UUIDScalarType], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  demoAttendeeIds?: string[];

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  demoScheduledAt?: Date;

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  demoOccurredAt?: Date;

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  proposalDeliveredAt?: Date;

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  nextActionAt?: Date;

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  lossDecisionAt?: Date;

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  revisitAt?: Date;

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  trialStartsAt?: Date;

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  trialEndsAt?: Date;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  futureFollowUp?: boolean;

  @Field(() => UUIDScalarType, { nullable: true })
  @IsOptional()
  @IsUUID()
  agreementId?: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  evidence: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  demoOutcome?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  commercialDecisionContext?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nextAction?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  acceptedTermsEvidence?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lossReason?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  trialApprovalEvidence?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  trialReason?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  trialSuccessCriteria?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  trialExpectedDecision?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  trialExtensionReason?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  trialOutcome?: string;
}
