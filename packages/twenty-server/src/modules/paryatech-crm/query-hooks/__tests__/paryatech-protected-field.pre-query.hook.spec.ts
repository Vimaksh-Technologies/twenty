import {
  ParyatechCompanyUpdateOnePreQueryHook,
  ParyatechPersonUpdateOnePreQueryHook,
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
