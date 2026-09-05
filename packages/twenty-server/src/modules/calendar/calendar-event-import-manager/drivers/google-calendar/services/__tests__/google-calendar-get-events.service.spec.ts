import { Test, type TestingModule } from '@nestjs/testing';

import { google } from 'googleapis';
import { ConnectedAccountProvider } from 'twenty-shared/types';

import { TwentyConfigService } from 'src/engine/core-modules/twenty-config/twenty-config.service';
import { type ConnectedAccountEntity } from 'src/engine/metadata-modules/connected-account/entities/connected-account.entity';
import { GoogleCalendarGetEventsService } from 'src/modules/calendar/calendar-event-import-manager/drivers/google-calendar/services/google-calendar-get-events.service';
import { GoogleOAuth2ClientProvider } from 'src/modules/connected-account/oauth2-client-manager/drivers/google/google-oauth2-client.provider';

jest.mock('googleapis', () => ({
  google: {
    calendar: jest.fn(),
  },
}));

describe('GoogleCalendarGetEventsService', () => {
  let service: GoogleCalendarGetEventsService;
  let twentyConfigService: { get: jest.Mock };
  let eventsList: jest.Mock;

  const connectedAccount: Pick<ConnectedAccountEntity, 'provider' | 'id'> = {
    id: 'connected-account-id',
    provider: ConnectedAccountProvider.GOOGLE,
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-05T12:34:56.789Z'));

    twentyConfigService = {
      get: jest.fn().mockReturnValue(90),
    };
    eventsList = jest.fn().mockResolvedValue({
      data: {
        items: [{ id: 'event-id', status: 'confirmed' }],
        nextSyncToken: 'forward-sync-token',
      },
    });

    (google.calendar as jest.Mock).mockReturnValue({
      events: {
        list: eventsList,
      },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleCalendarGetEventsService,
        {
          provide: GoogleOAuth2ClientProvider,
          useValue: {
            getClient: jest.fn().mockResolvedValue({}),
          },
        },
        {
          provide: TwentyConfigService,
          useValue: twentyConfigService,
        },
      ],
    }).compile();

    service = module.get(GoogleCalendarGetEventsService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it.each([
    {
      description: 'at the exact boundary clock',
      now: '2026-09-05T12:34:56.789Z',
      expectedTimeMin: '2026-06-07T12:34:56.789Z',
    },
    {
      description: 'one millisecond inside the boundary clock',
      now: '2026-09-05T12:34:56.788Z',
      expectedTimeMin: '2026-06-07T12:34:56.788Z',
    },
    {
      description: 'one millisecond outside the boundary clock',
      now: '2026-09-05T12:34:56.790Z',
      expectedTimeMin: '2026-06-07T12:34:56.790Z',
    },
  ])(
    'should set the exact initial timeMin $description',
    async ({ now, expectedTimeMin }) => {
      jest.setSystemTime(new Date(now));

      await service.getCalendarEvents(connectedAccount);

      expect(eventsList).toHaveBeenCalledWith({
        calendarId: 'primary',
        maxResults: 500,
        singleEvents: true,
        syncToken: undefined,
        timeMin: expectedTimeMin,
        pageToken: undefined,
        showDeleted: true,
      });
    },
  );

  it('should return the forward token when the initial result is empty', async () => {
    eventsList.mockResolvedValue({
      data: {
        items: [],
        nextSyncToken: 'empty-result-forward-token',
      },
    });

    await expect(service.getCalendarEvents(connectedAccount)).resolves.toEqual({
      calendarEventIds: [],
      calendarEventIdsToDelete: [],
      nextSyncCursor: 'empty-result-forward-token',
    });
  });

  it('should use only the incremental sync token after initial synchronization', async () => {
    twentyConfigService.get.mockReturnValue(0);

    await service.getCalendarEvents(
      connectedAccount,
      'current-incremental-sync-token',
    );

    expect(eventsList).toHaveBeenCalledWith({
      calendarId: 'primary',
      maxResults: 500,
      singleEvents: true,
      syncToken: 'current-incremental-sync-token',
      timeMin: undefined,
      pageToken: undefined,
      showDeleted: true,
    });
    expect(twentyConfigService.get).not.toHaveBeenCalled();
  });

  it.each([0, -1])(
    'should fail closed before initial synchronization for invalid lookback days: %s',
    async (lookbackDays) => {
      twentyConfigService.get.mockReturnValue(lookbackDays);

      await expect(service.getCalendarEvents(connectedAccount)).rejects.toThrow(
        'Initial sync lookback days must be a positive integer',
      );
      expect(eventsList).not.toHaveBeenCalled();
    },
  );
});
