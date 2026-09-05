import { Field, InputType } from '@nestjs/graphql';
import { IsIn, IsNotEmpty, IsString, IsUUID, MaxLength } from 'class-validator';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@InputType()
export class ClearSuppressionInput {
  @Field(() => String)
  @IsIn(['company', 'person'])
  targetObject: 'company' | 'person';

  @Field(() => UUIDScalarType)
  @IsUUID()
  targetId: string;

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
