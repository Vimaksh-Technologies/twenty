import { Module } from '@nestjs/common';

import {
  ParyatechCompanyCreateManyPreQueryHook,
  ParyatechCompanyCreateOnePreQueryHook,
  ParyatechCompanyUpdateManyPreQueryHook,
  ParyatechCompanyUpdateOnePreQueryHook,
  ParyatechPersonCreateManyPreQueryHook,
  ParyatechPersonCreateOnePreQueryHook,
  ParyatechPersonUpdateManyPreQueryHook,
  ParyatechPersonUpdateOnePreQueryHook,
} from 'src/modules/paryatech-crm/query-hooks/paryatech-protected-field.pre-query.hook';

@Module({
  providers: [
    ParyatechCompanyCreateManyPreQueryHook,
    ParyatechCompanyCreateOnePreQueryHook,
    ParyatechCompanyUpdateManyPreQueryHook,
    ParyatechCompanyUpdateOnePreQueryHook,
    ParyatechPersonCreateManyPreQueryHook,
    ParyatechPersonCreateOnePreQueryHook,
    ParyatechPersonUpdateManyPreQueryHook,
    ParyatechPersonUpdateOnePreQueryHook,
  ],
})
export class ParyatechQueryHookModule {}
