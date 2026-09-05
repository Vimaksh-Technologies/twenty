import { computeGmailInitialSyncQuery } from 'src/modules/messaging/message-import-manager/drivers/gmail/utils/compute-gmail-initial-sync-query.util';

describe('computeGmailInitialSyncQuery', () => {
  const now = new Date('2026-09-05T12:34:56.789Z');

  it('should append the exact-clock lookback cutoff to the folder query', () => {
    expect(
      computeGmailInitialSyncQuery({
        folderQuery: 'label:Customers -label:trash -label:spam -label:chat',
        lookbackDays: 90,
        now,
      }),
    ).toBe(
      'label:Customers -label:trash -label:spam -label:chat after:1780835696',
    );
  });

  it.each([
    {
      description: 'one second inside the boundary',
      now: new Date('2026-09-05T12:34:55.789Z'),
      expectedQuery: 'after:1780835695',
    },
    {
      description: 'one second outside the boundary',
      now: new Date('2026-09-05T12:34:57.789Z'),
      expectedQuery: 'after:1780835697',
    },
  ])('should preserve $description', ({ now, expectedQuery }) => {
    expect(
      computeGmailInitialSyncQuery({
        folderQuery: '',
        lookbackDays: 90,
        now,
      }),
    ).toBe(expectedQuery);
  });

  it.each([0, -1])(
    'should fail closed when lookback days is non-positive: %s',
    (lookbackDays) => {
      expect(() =>
        computeGmailInitialSyncQuery({
          folderQuery: '',
          lookbackDays,
          now,
        }),
      ).toThrow('Initial sync lookback days must be a positive integer');
    },
  );
});
