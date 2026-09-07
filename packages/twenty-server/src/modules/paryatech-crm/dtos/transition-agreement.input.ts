import { Field, Float, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import { type TransitionAgreementParams } from 'src/modules/paryatech-crm/types/paryatech-transition.type';

@InputType()
export class TransitionAgreementInput {
  @Field(() => UUIDScalarType)
  @IsUUID()
  agreementId: string;

  @Field(() => String)
  @IsIn(['PAYMENT', 'RENEWAL', 'ACTIVATION', 'ADOPTION'])
  transition: TransitionAgreementParams['transition'];

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  expectedState: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  targetState: string;

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

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  evidenceSource: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  evidenceType: string;

  @Field(() => Date)
  @Type(() => Date)
  @IsDate()
  evidenceObservedAt: Date;

  @Field(() => String)
  @IsIn(['Current', 'Stale', 'Conflict'])
  evidenceState: 'Current' | 'Stale' | 'Conflict';

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  amountCollected?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  waivedAmount?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  refundedOrReversedAmount?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  authorizationEvidence?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  renewalNextAction?: string;

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  renewalNextActionAt?: Date;

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  activationConfirmedAt?: Date;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  adoptionEvidence?: string;

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  adoptionObservedAt?: Date;
}
