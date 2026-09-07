import { Field, InputType } from '@nestjs/graphql';

import {
  IsBoolean,
  IsHash,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { GraphQLJSON } from 'graphql-type-json';

@InputType()
export class ApplyCommercialCutoverAgreementInput {
  @Field(() => Boolean)
  @IsBoolean()
  dryRun: boolean;

  @Field(() => String)
  @IsHash('sha256')
  evidenceHash: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsHash('sha256')
  expectedSnapshotHash?: string | null;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  idempotencyKey: string;

  @Field(() => GraphQLJSON)
  target: unknown;

  @Field(() => String)
  @IsHash('sha256')
  targetHash: string;
}
