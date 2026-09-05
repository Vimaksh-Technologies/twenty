import { type QueryRunner } from 'typeorm';

import { RegisteredInstanceCommand } from 'src/engine/core-modules/upgrade/decorators/registered-instance-command.decorator';
import { type FastInstanceCommand } from 'src/engine/core-modules/upgrade/interfaces/fast-instance-command.interface';

@RegisteredInstanceCommand('2.27.0', 1788588380000)
export class CreateParyatechGuardedActionReceiptFastInstanceCommand implements FastInstanceCommand {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "core"."paryatechGuardedActionReceipt" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "workspaceId" uuid NOT NULL,
        "actorType" text NOT NULL,
        "actorId" uuid NOT NULL,
        "action" text NOT NULL,
        "reason" text NOT NULL,
        "evidenceReference" text NOT NULL,
        "evidenceHash" char(64) NOT NULL,
        "occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "objectName" text NOT NULL,
        "recordId" uuid NOT NULL,
        "ownerId" uuid,
        "priorState" jsonb NOT NULL,
        "resultState" jsonb NOT NULL,
        "responseSummary" text,
        "schemaVersion" text NOT NULL,
        "receiptHash" char(64) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_PARYATECH_GUARDED_ACTION_RECEIPT" PRIMARY KEY ("id"),
        CONSTRAINT "FK_PARYATECH_GUARDED_ACTION_RECEIPT_WORKSPACE" FOREIGN KEY ("workspaceId")
          REFERENCES "core"."workspace"("id") ON DELETE CASCADE,
        CONSTRAINT "CHK_PARYATECH_GUARDED_ACTION_RECEIPT_ACTOR" CHECK ("actorType" IN ('HUMAN', 'API_KEY')),
        CONSTRAINT "CHK_PARYATECH_GUARDED_ACTION_RECEIPT_SCHEMA" CHECK ("schemaVersion" = 'paryatech-guarded-action-receipt/v1')
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_PARYATECH_GUARDED_ACTION_RECEIPT_TARGET"
        ON "core"."paryatechGuardedActionReceipt" ("workspaceId", "objectName", "recordId", "occurredAt")`,
    );
    await queryRunner.query(
      `CREATE OR REPLACE FUNCTION "core"."preventParyatechGuardedActionReceiptMutation"()
        RETURNS trigger AS $$
        BEGIN
          IF TG_OP = 'UPDATE' OR pg_trigger_depth() = 1 THEN
            RAISE EXCEPTION 'Guarded action receipts are immutable';
          END IF;
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql`,
    );
    await queryRunner.query(
      `DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1
            FROM pg_trigger
            WHERE tgname = 'TRG_PARYATECH_GUARDED_ACTION_RECEIPT_IMMUTABLE'
              AND tgrelid = '"core"."paryatechGuardedActionReceipt"'::regclass
          ) THEN
            CREATE TRIGGER "TRG_PARYATECH_GUARDED_ACTION_RECEIPT_IMMUTABLE"
              BEFORE UPDATE OR DELETE
              ON "core"."paryatechGuardedActionReceipt"
              FOR EACH ROW
              EXECUTE FUNCTION "core"."preventParyatechGuardedActionReceiptMutation"();
          END IF;
        END
        $$`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS "core"."paryatechGuardedActionReceipt"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS "core"."preventParyatechGuardedActionReceiptMutation"()',
    );
  }
}
