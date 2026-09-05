import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType('MessageAttachmentDownloadGrant')
export class MessageAttachmentDownloadGrantDTO {
  @Field(() => String)
  url: string;

  @Field(() => String)
  token: string;

  @Field(() => Date)
  expiresAt: Date;
}
