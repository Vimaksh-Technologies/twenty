import { type QueryRunner } from 'typeorm';

import { CreateParyatechGuardedActionReceiptFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-27/2-27-instance-command-fast-1788588380000-create-paryatech-guarded-action-receipt';

describe('CreateParyatechGuardedActionReceiptFastInstanceCommand', () => {
  it('should create append-only reconstruction evidence for human and API actors', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command = new CreateParyatechGuardedActionReceiptFastInstanceCommand();

    await command.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(4);
    const createTableSql = String(query.mock.calls[0]?.[0]);
    expect(createTableSql).toContain('"actorType" text NOT NULL');
    expect(createTableSql).toContain('"actorId" uuid NOT NULL');
    expect(createTableSql).toContain('"action" text NOT NULL');
    expect(createTableSql).toContain('"reason" text NOT NULL');
    expect(createTableSql).toContain('"evidenceReference" text NOT NULL');
    expect(createTableSql).toContain('"evidenceHash" char(64) NOT NULL');
    expect(createTableSql).toContain('"occurredAt" TIMESTAMP WITH TIME ZONE NOT NULL');
    expect(createTableSql).toContain('"priorState" jsonb NOT NULL');
    expect(createTableSql).toContain('"resultState" jsonb NOT NULL');
    expect(createTableSql).toContain('"responseSummary" text');
    expect(createTableSql).toContain('"receiptHash" char(64) NOT NULL');
    expect(createTableSql).toContain(
      "CHECK (\"schemaVersion\" = 'paryatech-guarded-action-receipt/v1')",
    );
    expect(String(query.mock.calls[1]?.[0])).toContain(
      '"workspaceId", "objectName", "recordId", "occurredAt"',
    );
    expect(String(query.mock.calls[2]?.[0])).toContain(
      'Guarded action receipts are immutable',
    );
    expect(String(query.mock.calls[2]?.[0])).toContain(
      'pg_trigger_depth() = 1',
    );
    expect(String(query.mock.calls[3]?.[0])).toContain(
      'BEFORE UPDATE OR DELETE',
    );
  });

  it('should remove only guarded-action receipt storage on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command = new CreateParyatechGuardedActionReceiptFastInstanceCommand();

    await command.down({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "core"."paryatechGuardedActionReceipt"',
    );
    expect(query).toHaveBeenCalledWith(
      'DROP FUNCTION IF EXISTS "core"."preventParyatechGuardedActionReceiptMutation"()',
    );
  });
});
