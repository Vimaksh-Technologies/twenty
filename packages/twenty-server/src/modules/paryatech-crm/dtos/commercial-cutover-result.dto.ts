import { Field, ObjectType } from '@nestjs/graphql';

import { GraphQLJSON } from 'graphql-type-json';

import { UUIDScalarType } from 'src/engine/api/graphql/workspace-schema-builder/graphql-types/scalars';

@ObjectType('ParyatechCommercialCutoverResult')
export class CommercialCutoverResultDTO {
  @Field(() => String)
  actorApiKeyIdHash: string;

  @Field(() => Boolean)
  created: boolean;

  @Field(() => String)
  evidenceHash: string;

  @Field(() => String)
  idempotencyKey: string;

  @Field(() => GraphQLJSON, { nullable: true })
  previous: Record<string, unknown> | null;

  @Field(() => String, { nullable: true })
  receiptHash: string | null;

  @Field(() => UUIDScalarType, { nullable: true })
  recordId: string | null;

  @Field(() => Boolean)
  replayed: boolean;

  @Field(() => String)
  requestHash: string;

  @Field(() => GraphQLJSON)
  snapshot: Record<string, unknown>;

  @Field(() => String)
  status: 'DRY_RUN' | 'APPLIED';

  @Field(() => String)
  targetHash: string;
}
