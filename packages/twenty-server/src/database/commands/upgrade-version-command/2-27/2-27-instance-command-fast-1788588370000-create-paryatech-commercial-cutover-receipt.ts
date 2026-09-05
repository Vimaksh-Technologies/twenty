import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.27.0', 1788588370000)
export class CreateParyatechCommercialCutoverReceiptFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "core"."paryatechCommercialCutoverReceipt" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "apiKeyId" uuid NOT NULL,
        "actorApiKeyIdHash" char(64) NOT NULL,
        "idempotencyKey" char(64) NOT NULL,
        "requestHash" char(64) NOT NULL,
        "targetHash" char(64) NOT NULL,
        "evidenceHash" char(64) NOT NULL,
        "recordId" uuid NOT NULL,
        "created" boolean NOT NULL,
        "previous" jsonb,
        "snapshot" jsonb NOT NULL,
        "schemaVersion" text NOT NULL,
        "receiptHash" char(64) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_PARYATECH_COMMERCIAL_CUTOVER_RECEIPT" PRIMARY KEY ("id"),
        CONSTRAINT "FK_PARYATECH_COMMERCIAL_CUTOVER_RECEIPT_WORKSPACE" FOREIGN KEY ("workspaceId")
          REFERENCES "core"."workspace"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_PARYATECH_COMMERCIAL_CUTOVER_RECEIPT_SCHEMA" CHECK ("schemaVersion" = 'paryatech-commercial-cutover-receipt/v1'),
        CONSTRAINT "UQ_PARYATECH_COMMERCIAL_CUTOVER_RECEIPT_KEY" UNIQUE ("workspaceId", "idempotencyKey")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_PARYATECH_COMMERCIAL_CUTOVER_RECEIPT_SOURCE"
        ON "core"."paryatechCommercialCutoverReceipt" (("snapshot"->>'paryatechOsCommercialReference'))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "core"."paryatechCommercialCutoverReceipt"`,
    );
  }
}
