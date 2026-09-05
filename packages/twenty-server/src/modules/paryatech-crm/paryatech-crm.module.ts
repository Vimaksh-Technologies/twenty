import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { TwentyORMModule } from 'src/engine/twenty-orm/twenty-orm.module';
import { AgencyReservationExpiryJob } from 'src/modules/paryatech-crm/jobs/agency-reservation-expiry.job';
import { ParyatechQueryHookModule } from 'src/modules/paryatech-crm/query-hooks/paryatech-query-hook.module';
import { ParyatechCrmResolver } from 'src/modules/paryatech-crm/resolvers/paryatech-crm.resolver';
import { AgencyOutreachService } from 'src/modules/paryatech-crm/services/agency-outreach.service';
import { AgencyContactControlService } from 'src/modules/paryatech-crm/services/agency-contact-control.service';
import { TypeOrmAgencyContactControlStore } from 'src/modules/paryatech-crm/services/agency-contact-control.store';
import { AgencyContactControlStore } from 'src/modules/paryatech-crm/types/agency-contact-control.type';

@Module({
  imports: [
    TypeOrmModule.forFeature([ObjectMetadataEntity, FieldMetadataEntity]),
    PermissionsModule,
    TwentyORMModule,
    ParyatechQueryHookModule,
  ],
  providers: [
    ParyatechCrmResolver,
    AgencyContactControlService,
    AgencyOutreachService,
    AgencyReservationExpiryJob,
    TypeOrmAgencyContactControlStore,
    {
      provide: AgencyContactControlStore,
      useExisting: TypeOrmAgencyContactControlStore,
    },
  ],
})
export class ParyatechCrmModule {}
