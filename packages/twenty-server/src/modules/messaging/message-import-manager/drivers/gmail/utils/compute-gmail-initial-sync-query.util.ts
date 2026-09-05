const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

type ComputeGmailInitialSyncQueryArgs = {
  folderQuery: string;
  lookbackDays: number;
  now?: Date;
};

export const computeGmailInitialSyncQuery = ({
  folderQuery,
  lookbackDays,
  now = new Date(),
}: ComputeGmailInitialSyncQueryArgs): string => {
  if (!Number.isInteger(lookbackDays) || lookbackDays <= 0) {
    throw new Error('Initial sync lookback days must be a positive integer');
  }

  const cutoffEpochSeconds = Math.floor(
    (now.getTime() - lookbackDays * MILLISECONDS_PER_DAY) / 1000,
  );
  const lookbackQuery = `after:${cutoffEpochSeconds}`;

  return folderQuery.length > 0
    ? `${folderQuery} ${lookbackQuery}`
    : lookbackQuery;
};
