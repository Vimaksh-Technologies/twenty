import {
  ParyatechCompanyUpdateOnePreQueryHook,
  ParyatechCommercialAgreementUpdateOnePreQueryHook,
  ParyatechOpportunityUpdateOnePreQueryHook,
  ParyatechPersonUpdateOnePreQueryHook,
  ParyatechSharedExceptionUpdateOnePreQueryHook,
  ParyatechSupportCaseUpdateOnePreQueryHook,
  ParyatechSupportReceiptCreateOnePreQueryHook,
} from 'src/modules/paryatech-crm/query-hooks/paryatech-protected-field.pre-query.hook';
import { type WorkspaceAuthContext } from 'src/engine/core-modules/auth/types/workspace-auth-context.type';

describe('Paryatech protected Company field hook', () => {
  const hook = new ParyatechCompanyUpdateOnePreQueryHook();
  const authContext = {
    type: 'user',
    user: { id: 'user-1' },
    workspace: { id: 'workspace-1' },
  } as WorkspaceAuthContext;

  it('should reject direct protected-field changes without altering the payload', async () => {
    const payload = { data: { name: 'Agency', reservationStatus: 'Claimed' } };
    await expect(
      hook.execute(authContext, 'company', payload),
    ).rejects.toMatchObject({ code: 'PROTECTED_FIELD_WRITE' });
    expect(payload.data.reservationStatus).toBe('Claimed');
  });

  it('should allow ordinary Company field changes', async () => {
    const payload = { data: { name: 'Renamed Agency' } };
    await expect(hook.execute(authContext, 'company', payload)).resolves.toBe(
      payload,
    );
  });

  it('should reject direct suppression clearance for people', async () => {
    const personHook = new ParyatechPersonUpdateOnePreQueryHook();
    const payload = { data: { isSuppressed: false } };

    await expect(
      personHook.execute(authContext, 'person', payload),
    ).rejects.toMatchObject({ code: 'PROTECTED_FIELD_WRITE' });
  });
});

describe('Paryatech U6 protected field hooks', () => {
  const authContext = {
    type: 'user',
    user: { id: 'user-1' },
    workspace: { id: 'workspace-1' },
  } as WorkspaceAuthContext;

  it.each([
    [new ParyatechOpportunityUpdateOnePreQueryHook(), 'opportunity', 'stage'],
    [
      new ParyatechCommercialAgreementUpdateOnePreQueryHook(),
      'commercialAgreement',
      'paymentState',
    ],
    [
      new ParyatechSupportCaseUpdateOnePreQueryHook(),
      'supportCase',
      'firstSubstantiveResponseAt',
    ],
    [
      new ParyatechSupportReceiptCreateOnePreQueryHook(),
      'supportReceipt',
      'receiptKey',
    ],
    [
      new ParyatechSharedExceptionUpdateOnePreQueryHook(),
      'sharedException',
      'resumedAt',
    ],
  ] as const)(
    'should reject a forged direct %s write to %s',
    async (hook, objectName, protectedField) => {
      await expect(
        hook.execute(authContext, objectName, {
          data: { [protectedField]: 'forged' },
        }),
      ).rejects.toMatchObject({ code: 'PROTECTED_FIELD_WRITE' });
    },
  );

  it.each([
    [new ParyatechOpportunityUpdateOnePreQueryHook(), 'opportunity', 'amount'],
    [
      new ParyatechOpportunityUpdateOnePreQueryHook(),
      'opportunity',
      'primarySource',
    ],
    [
      new ParyatechCommercialAgreementUpdateOnePreQueryHook(),
      'commercialAgreement',
      'agreementReference',
    ],
    [
      new ParyatechCommercialAgreementUpdateOnePreQueryHook(),
      'commercialAgreement',
      'paryatechOsCommercialReference',
    ],
    [new ParyatechSupportCaseUpdateOnePreQueryHook(), 'supportCase', 'owner'],
  ] as const)(
    'should reject every sampled U1 protected %s field %s',
    async (hook, objectName, protectedField) => {
      await expect(
        hook.execute(authContext, objectName, {
          data: { [protectedField]: 'forged' },
        }),
      ).rejects.toMatchObject({ code: 'PROTECTED_FIELD_WRITE' });
    },
  );

  it('should reject protected writes from integration auth contexts', async () => {
    const hook = new ParyatechSupportReceiptCreateOnePreQueryHook();
    const apiKeyAuthContext = {
      type: 'apiKey',
      apiKey: { id: 'api-key-1' },
      workspace: { id: 'workspace-1' },
    } as WorkspaceAuthContext;

    await expect(
      hook.execute(apiKeyAuthContext, 'supportReceipt', {
        data: { receiptKey: 'forged' },
      }),
    ).rejects.toMatchObject({ code: 'PROTECTED_FIELD_WRITE' });
  });
});
