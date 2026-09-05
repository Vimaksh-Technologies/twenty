import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { type SelectOption } from 'twenty-ui/input';

type AgencyContactRecord = {
  id: string;
  name?: {
    firstName?: string;
    lastName?: string;
  };
  emails?: {
    primaryEmail?: string;
  };
};

export const useAgencyContactOptions = (agencyId: string) => {
  const { records, loading } = useFindManyRecords({
    objectNameSingular: CoreObjectNameSingular.Person,
    filter: {
      companyId: { eq: agencyId },
      isSuppressed: { eq: false },
      not: {
        contactStatus: { in: ['Inactive', 'Left Agency'] },
      },
    },
    recordGqlFields: {
      id: true,
      name: true,
      emails: { primaryEmail: true },
    },
    skip: agencyId.length === 0,
  });

  const options: SelectOption<string>[] = (
    records as AgencyContactRecord[]
  ).map((contact) => {
    const fullName = [contact.name?.firstName, contact.name?.lastName]
      .filter((namePart) => namePart !== undefined && namePart.length > 0)
      .join(' ');
    const primaryEmail = contact.emails?.primaryEmail ?? '';
    const label = [fullName, primaryEmail]
      .filter((value) => value.length > 0)
      .join(' · ');

    return {
      value: contact.id,
      label: label || 'Unnamed Contact',
    };
  });

  return { options, loading };
};
