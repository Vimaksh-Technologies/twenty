import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@InputType()
export class RecordSubstantiveResponseInput {
  @Field(() => UUIDScalarType)
  @IsUUID()
  supportCaseId: string;
  @Field(() => Date)
  @Type(() => Date)
  @IsDate()
  respondedAt: Date;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  responseSummary: string;

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
}
