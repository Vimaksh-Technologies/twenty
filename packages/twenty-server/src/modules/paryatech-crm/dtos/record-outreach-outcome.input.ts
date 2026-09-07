import { Field, InputType, registerEnumType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';
import {
  OUTREACH_OUTCOME,
  type OutreachOutcome,
} from 'src/modules/paryatech-crm/types/agency-contact-control.type';

registerEnumType(OUTREACH_OUTCOME, { name: 'ParyatechOutreachOutcome' });

@InputType()
export class RecordOutreachOutcomeInput {
  @Field(() => UUIDScalarType)
  @IsUUID()
  agencyId: string;

  @Field(() => UUIDScalarType, { nullable: true })
  @IsOptional()
  @IsUUID()
  contactId?: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  channel: string;

  @Field(() => String)
  @IsEnum(OUTREACH_OUTCOME)
  outcome: OutreachOutcome;

  @Field(() => Date)
  @Type(() => Date)
  @IsDate()
  occurredAt: Date;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  providerEvidenceKey?: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  evidence: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  @Field(() => String)
  @IsString()
  @MaxLength(500)
  nextAction: string;

  @Field(() => Date, { nullable: true })
  @Type(() => Date)
  @IsOptional()
  @IsDate()
  nextActionAt?: Date;
}
