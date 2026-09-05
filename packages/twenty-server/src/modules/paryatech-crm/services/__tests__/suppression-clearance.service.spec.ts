import { ParyatechCrmExceptionCode } from 'src/modules/paryatech-crm/exceptions/paryatech-crm.exception';
import { SuppressionClearanceService } from 'src/modules/paryatech-crm/services/suppression-clearance.service';
import { InMemoryParyatechTransitionStore } from 'src/modules/paryatech-crm/services/__tests__/paryatech-transition-test.store';
import { type ClearSuppressionParams } from 'src/modules/paryatech-crm/types/paryatech-transition.type';

const NOW = new Date('2026-09-04T10:00:00.000Z');

const setup = () => {
  const store = new InMemoryParyatechTransitionStore();
  store.roleLabel = 'Paryatech Legal Compliance';
  store.records = {
    company: [
      {
        id: 'agency-1',
        isSuppressed: true,
        agencyDisposition: 'Suppressed',
        suppressionReason: 'Opt-out received on source channel.',
        suppressedAt: new Date('2026-08-01T10:00:00.000Z'),
        suppressionClearedAt: null,
        suppressionClearanceReason: null,
      },
    ],
    person: [
      {
        id: 'contact-1',
        companyId: 'agency-1',
        isSuppressed: true,
        suppressionReason: 'Contact-level opt-out.',
        suppressedAt: new Date('2026-08-02T10:00:00.000Z'),
        suppressionClearedAt: null,
        suppressionClearanceReason: null,
      },
    ],
  };

  return { store, service: new SuppressionClearanceService(store) };
};

const input = (targetObject: 'company' | 'person'): ClearSuppressionParams => ({
  workspaceId: 'workspace-1',
  userWorkspaceId: 'user-workspace-1',
  actorWorkspaceMemberId: 'legal-member-1',
  targetObject,
  targetId: targetObject === 'company' ? 'agency-1' : 'contact-1',
  reason: 'Verified renewed outreach consent.',
  evidence: 'Retained legal review reference LC-1.',
  now: NOW,
});

describe('SuppressionClearanceService', () => {
  it.each(['company', 'person'] as const)(
    'should clear %s suppression while retaining original evidence',
    async (targetObject) => {
      const { store, service } = setup();
      const before = { ...store.records[targetObject][0] };

      const result = await service.clear(input(targetObject));

      expect(result.state).toBe('Cleared');
      expect(store.records[targetObject][0]).toMatchObject({
        isSuppressed: false,
        suppressionReason: before.suppressionReason,
        suppressedAt: before.suppressedAt,
        suppressionClearedAt: NOW,
        suppressionClearanceReason:
          'Verified renewed outreach consent. Evidence: Retained legal review reference LC-1.',
      });
    },
  );

  it.each(['company', 'person'] as const)(
    'should reject %s clearance without evidence',
    async (targetObject) => {
      const { service } = setup();

      await expect(
        service.clear({ ...input(targetObject), evidence: '' }),
      ).rejects.toMatchObject({
        code: ParyatechCrmExceptionCode.EVIDENCE_REQUIRED,
      });
    },
  );

  it.each(['company', 'person'] as const)(
    'should reject %s clearance for every non-legal role',
    async (targetObject) => {
      const { store, service } = setup();
      store.roleLabel = 'Paryatech Commercial Sensitive';

      await expect(service.clear(input(targetObject))).rejects.toMatchObject({
        code: ParyatechCrmExceptionCode.PERMISSION_DENIED,
      });
      expect(store.records[targetObject][0].isSuppressed).toBe(true);
    },
  );
});
