import { Field, InputType } from '@nestjs/graphql';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import {
  type SupportDisposition,
  type SupportStatus,
} from 'src/modules/paryatech-crm/types/paryatech-transition.type';

const CASE_STATUSES = [
  'New',
  'Assigned',
  'In Progress',
  'Waiting on Agency',
  'Waiting Internal',
  'Resolved',
  'Closed',
] as const;
const CASE_DISPOSITIONS = [
  'Support',
  'Duplicate',
  'Non-support',
  'Resolved',
  'Withdrawn',
] as const;

@InputType()
export class TransitionSupportCaseInput {
  @Field(() => UUIDScalarType)
  @IsUUID()
  supportCaseId: string;

  @Field(() => String)
  @IsIn(CASE_STATUSES)
  expectedStatus: SupportStatus;

  @Field(() => String)
  @IsIn(CASE_STATUSES)
  targetStatus: SupportStatus;

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
  @IsIn(CASE_DISPOSITIONS)
  disposition: SupportDisposition;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolution?: string;
}
