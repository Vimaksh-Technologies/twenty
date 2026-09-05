import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { FieldMetadataEntity } from 'src/engine/metadata-modules/field-metadata/field-metadata.entity';
import { ObjectMetadataEntity } from 'src/engine/metadata-modules/object-metadata/object-metadata.entity';
import { RoleEntity } from 'src/engine/metadata-modules/role/role.entity';
import { UserRoleModule } from 'src/engine/metadata-modules/user-role/user-role.module';
import { PermissionsModule } from 'src/engine/metadata-modules/permissions/permissions.module';
import { TwentyORMModule } from 'src/engine/twenty-orm/twenty-orm.module';
import { provideWorkspaceScopedRepository } from 'src/engine/twenty-orm/workspace-scoped-repository/provide-workspace-scoped-repository';
import { AgencyReservationExpiryJob } from 'src/modules/paryatech-crm/jobs/agency-reservation-expiry.job';
import { ParyatechQueryHookModule } from 'src/modules/paryatech-crm/query-hooks/paryatech-query-hook.module';
import { ParyatechCrmResolver } from 'src/modules/paryatech-crm/resolvers/paryatech-crm.resolver';
import { AgencyOutreachService } from 'src/modules/paryatech-crm/services/agency-outreach.service';
import { AgreementTransitionService } from 'src/modules/paryatech-crm/services/agreement-transition.service';
import { AgencyContactControlService } from 'src/modules/paryatech-crm/services/agency-contact-control.service';
import { TypeOrmAgencyContactControlStore } from 'src/modules/paryatech-crm/services/agency-contact-control.store';
import { OpportunityTransitionService } from 'src/modules/paryatech-crm/services/opportunity-transition.service';
import { TypeOrmParyatechTransitionStore } from 'src/modules/paryatech-crm/services/paryatech-transition.store';
import { ParyatechCrmActionAvailabilityService } from 'src/modules/paryatech-crm/services/paryatech-crm-action-availability.service';
import { SharedExceptionService } from 'src/modules/paryatech-crm/services/shared-exception.service';
import { SupportCaseIntakeService } from 'src/modules/paryatech-crm/services/support-case-intake.service';
import { SuppressionClearanceService } from 'src/modules/paryatech-crm/services/suppression-clearance.service';
import { AgencyContactControlStore } from 'src/modules/paryatech-crm/types/agency-contact-control.type';
import { ParyatechTransitionStore } from 'src/modules/paryatech-crm/types/paryatech-transition.type';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ObjectMetadataEntity,
      FieldMetadataEntity,
      RoleEntity,
    ]),
    PermissionsModule,
    UserRoleModule,
    TwentyORMModule,
    ParyatechQueryHookModule,
  ],
  providers: [
    ParyatechCrmResolver,
    AgencyContactControlService,
    AgencyOutreachService,
    AgencyReservationExpiryJob,
    TypeOrmAgencyContactControlStore,
    OpportunityTransitionService,
    AgreementTransitionService,
    SupportCaseIntakeService,
    SuppressionClearanceService,
    SharedExceptionService,
    ParyatechCrmActionAvailabilityService,
    TypeOrmParyatechTransitionStore,
    provideWorkspaceScopedRepository(RoleEntity),
    {
      provide: AgencyContactControlStore,
      useExisting: TypeOrmAgencyContactControlStore,
    },
    {
      provide: ParyatechTransitionStore,
      useExisting: TypeOrmParyatechTransitionStore,
    },
  ],
})
export class ParyatechCrmModule {}
