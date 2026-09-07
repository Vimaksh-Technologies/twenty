import { type QueryRunner } from 'typeorm';

import { CreateParyatechCommercialCutoverReceiptFastInstanceCommand } from 'src/database/commands/upgrade-version-command/2-27/2-27-instance-command-fast-1788588370000-create-paryatech-commercial-cutover-receipt';

describe('CreateParyatechCommercialCutoverReceiptFastInstanceCommand', () => {
  it('should create immutable receipt storage with workspace idempotency and evidence constraints', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command = new CreateParyatechCommercialCutoverReceiptFastInstanceCommand();

    await command.up({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledTimes(2);
    const createTableSql = String(query.mock.calls[0]?.[0]);
    expect(createTableSql).toContain(
      '"UQ_PARYATECH_COMMERCIAL_CUTOVER_RECEIPT_KEY" UNIQUE ("workspaceId", "idempotencyKey")',
    );
    expect(createTableSql).toContain('"apiKeyId" uuid NOT NULL');
    expect(createTableSql).toContain('"previous" jsonb');
    expect(createTableSql).toContain(
      '"actorApiKeyIdHash" char(64) NOT NULL',
    );
    expect(createTableSql).toContain('"receiptHash" char(64) NOT NULL');
    expect(createTableSql).toContain(
      "CHECK (\"schemaVersion\" = 'paryatech-commercial-cutover-receipt/v1')",
    );
  });

  it('should remove only the receipt table on rollback', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const command = new CreateParyatechCommercialCutoverReceiptFastInstanceCommand();

    await command.down({ query } as unknown as QueryRunner);

    expect(query).toHaveBeenCalledWith(
      'DROP TABLE IF EXISTS "core"."paryatechCommercialCutoverReceipt"',
    );
  });
});
