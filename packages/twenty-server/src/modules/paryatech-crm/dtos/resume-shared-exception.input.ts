import { Field, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@InputType()
export class ResumeSharedExceptionInput {
  @Field(() => UUIDScalarType)
  @IsUUID()
  sharedExceptionId: string;
  @Field(() => Boolean)
  @IsBoolean()
  gatePassed: boolean;

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
