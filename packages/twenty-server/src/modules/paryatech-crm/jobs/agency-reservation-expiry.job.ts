import { Process } from 'src/engine/core-modules/message-queue/decorators/process.decorator';
import { Processor } from 'src/engine/core-modules/message-queue/decorators/processor.decorator';
import { MessageQueue } from 'src/engine/core-modules/message-queue/message-queue.constants';
import { AgencyContactControlService } from 'src/modules/paryatech-crm/services/agency-contact-control.service';

export type AgencyReservationExpiryJobData = {
  workspaceId: string;
  requestedAt: string;
  batchSize?: number;
};

@Processor(MessageQueue.cronQueue)
export class AgencyReservationExpiryJob {
  constructor(
    private readonly agencyContactControlService: AgencyContactControlService,
  ) {}

  @Process(AgencyReservationExpiryJob.name)
  async handle(data: AgencyReservationExpiryJobData): Promise<number> {
    return this.agencyContactControlService.expireReservations({
      workspaceId: data.workspaceId,
      now: new Date(data.requestedAt),
      batchSize: data.batchSize,
    });
  }
}
