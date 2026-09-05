import { useFindManyRecords } from '@/object-record/hooks/useFindManyRecords';
import { CoreObjectNameSingular } from 'twenty-shared/types';
import { type SelectOption } from 'twenty-ui/input';

type NamedRecord = {
  id: string;
  name?: string | { firstName?: string; lastName?: string };
  agreementReference?: string;
};

const labelForRecord = (record: NamedRecord) => {
  if (typeof record.name === 'string' && record.name.length > 0) {
    return record.name;
  }
  if (typeof record.name === 'object') {
    const fullName = [record.name.firstName, record.name.lastName]
      .filter((namePart) => namePart !== undefined && namePart.length > 0)
      .join(' ');
    if (fullName.length > 0) {
      return fullName;
    }
  }
  return record.agreementReference ?? 'Unnamed record';
};

const toOptions = (records: NamedRecord[]): SelectOption<string>[] =>
  records.map((record) => ({
    value: record.id,
    label: labelForRecord(record),
  }));

export const useParyatechOpportunityRelationOptions = (enabled: boolean) => {
  const contacts = useFindManyRecords({
    objectNameSingular: CoreObjectNameSingular.Person,
    recordGqlFields: { id: true, name: true },
    skip: !enabled,
  });
  const products = useFindManyRecords({
    objectNameSingular: 'product',
    recordGqlFields: { id: true, name: true },
    skip: !enabled,
  });
  const agreements = useFindManyRecords({
    objectNameSingular: 'commercialAgreement',
    recordGqlFields: { id: true, agreementReference: true },
    skip: !enabled,
  });

  return {
    contactOptions: toOptions(contacts.records as NamedRecord[]),
    productOptions: toOptions(products.records as NamedRecord[]),
    agreementOptions: toOptions(agreements.records as NamedRecord[]),
    loading: contacts.loading || products.loading || agreements.loading,
  };
};
