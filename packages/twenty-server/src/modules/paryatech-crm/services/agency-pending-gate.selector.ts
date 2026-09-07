import { UNRESOLVED_EXCEPTION_STATUSES } from 'src/modules/paryatech-crm/services/agency-contact-control.helpers';
import { type WorkspaceRecord } from 'src/modules/paryatech-crm/services/agency-contact-control-record.mapper';

export type PendingGateRows = {
  pendingOutreachRow: WorkspaceRecord | null;
  pendingExceptionRow: WorkspaceRecord | null;
};

const snapshotAgencyId = (exception: WorkspaceRecord) => {
  if (typeof exception.lastTrustedState !== 'string') {
    return null;
  }

  try {
    const snapshot = JSON.parse(exception.lastTrustedState) as {
      agencyId?: unknown;
    };

    return typeof snapshot.agencyId === 'string' ? snapshot.agencyId : null;
  } catch {
    return null;
  }
};

const dateValue = (value: unknown) => {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    return Number.POSITIVE_INFINITY;
  }

  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
};

const compareExceptions = (left: WorkspaceRecord, right: WorkspaceRecord) =>
  dateValue(left.dueAt) - dateValue(right.dueAt) ||
  String(left.id).localeCompare(String(right.id));

const compareEvents = (left: WorkspaceRecord, right: WorkspaceRecord) =>
  dateValue(left.pendingExpiresAt) - dateValue(right.pendingExpiresAt) ||
  String(left.id).localeCompare(String(right.id));

const isActiveException = (exception: WorkspaceRecord) =>
  typeof exception.status === 'string' &&
  UNRESOLVED_EXCEPTION_STATUSES.includes(
    exception.status as (typeof UNRESOLVED_EXCEPTION_STATUSES)[number],
  );

export const selectPendingGateRows = ({
  agencyId,
  pendingOutreachRows,
  exceptionsForPendingRows,
  activeOutreachExceptions,
  referencedOutreachRows,
}: {
  agencyId: string;
  pendingOutreachRows: WorkspaceRecord[];
  exceptionsForPendingRows: WorkspaceRecord[];
  activeOutreachExceptions: WorkspaceRecord[];
  referencedOutreachRows: WorkspaceRecord[];
}): PendingGateRows => {
  const outreachById = new Map(
    [...pendingOutreachRows, ...referencedOutreachRows].map((outreach) => [
      outreach.id,
      outreach,
    ]),
  );
  const relevantActiveException = activeOutreachExceptions
    .filter((exception) => {
      if (!isActiveException(exception)) {
        return false;
      }

      if (
        exception.affectedObject === 'company' &&
        exception.affectedRecordId === agencyId
      ) {
        return true;
      }

      const outreach = outreachById.get(exception.affectedRecordId);

      return (
        outreach?.agencyId === agencyId ||
        snapshotAgencyId(exception) === agencyId
      );
    })
    .sort(compareExceptions)[0];

  if (relevantActiveException !== undefined) {
    const referencedOutreach = outreachById.get(
      relevantActiveException.affectedRecordId,
    );
    const validPendingOutreach =
      referencedOutreach?.agencyId === agencyId &&
      referencedOutreach.outcome === 'Pending / Unknown'
        ? referencedOutreach
        : null;

    return {
      pendingOutreachRow: validPendingOutreach,
      pendingExceptionRow: relevantActiveException,
    };
  }

  const eventWithoutException = pendingOutreachRows
    .filter((outreach) => {
      const relatedExceptions = exceptionsForPendingRows.filter(
        (exception) => exception.affectedRecordId === outreach.id,
      );

      return relatedExceptions.length === 0;
    })
    .sort(compareEvents)[0];

  return {
    pendingOutreachRow: eventWithoutException ?? null,
    pendingExceptionRow: null,
  };
};
