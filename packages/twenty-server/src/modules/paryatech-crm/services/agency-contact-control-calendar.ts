import { type BusinessCalendar } from 'src/modules/paryatech-crm/types/agency-contact-control.type';

type CalendarParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type BusinessCalendarPayload = {
  timezone?: unknown;
  workdays?: unknown;
  holidays?: unknown;
  hours?: unknown;
};

const parseClock = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) {
    return null;
  }

  const [hours, minutes] = value.split(':').map(Number);

  return hours <= 23 && minutes <= 59 ? hours * 60 + minutes : null;
};

export const parseBusinessCalendar = (
  value: unknown,
): BusinessCalendar | null => {
  if (typeof value !== 'string') {
    return null;
  }

  let payload: BusinessCalendarPayload;

  try {
    payload = JSON.parse(value) as BusinessCalendarPayload;
  } catch {
    return null;
  }

  const hours =
    typeof payload.hours === 'object' && payload.hours !== null
      ? (payload.hours as { start?: unknown; end?: unknown })
      : {};
  const startTimeMinutes = parseClock(hours.start);
  const endTimeMinutes = parseClock(hours.end);
  const workdays = Array.isArray(payload.workdays)
    ? payload.workdays.filter(
        (day): day is number =>
          Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6,
      )
    : [];
  const holidays = Array.isArray(payload.holidays)
    ? payload.holidays.filter(
        (holiday): holiday is string => typeof holiday === 'string',
      )
    : [];

  if (
    typeof payload.timezone !== 'string' ||
    workdays.length === 0 ||
    startTimeMinutes === null ||
    endTimeMinutes === null ||
    startTimeMinutes >= endTimeMinutes
  ) {
    return null;
  }

  try {
    new Intl.DateTimeFormat('en-US', {
      timeZone: payload.timezone,
    }).format();
  } catch {
    return null;
  }

  return {
    timezone: payload.timezone,
    workdays,
    holidays,
    startTimeMinutes,
    endTimeMinutes,
  };
};

const getCalendarParts = (date: Date, timezone: string): CalendarParts => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);

  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
};

const toZonedInstant = (parts: CalendarParts, timezone: string) => {
  const desiredTime = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  let result = new Date(desiredTime);

  for (let iteration = 0; iteration < 2; iteration += 1) {
    const observed = getCalendarParts(result, timezone);
    const observedTime = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    result = new Date(result.getTime() + desiredTime - observedTime);
  }

  return result;
};

const getDateKey = (parts: CalendarParts) =>
  `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;

const addCalendarDays = (parts: CalendarParts, days: number): CalendarParts => {
  const date = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day + days,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
};

const isBusinessDay = (parts: CalendarParts, calendar: BusinessCalendar) => {
  const day = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day),
  ).getUTCDay();

  return (
    calendar.workdays.includes(day) &&
    !calendar.holidays.includes(getDateKey(parts))
  );
};

const nextBusinessDayOpening = (
  parts: CalendarParts,
  calendar: BusinessCalendar,
): CalendarParts => {
  let next = addCalendarDays(parts, 1);

  while (!isBusinessDay(next, calendar)) {
    next = addCalendarDays(next, 1);
  }

  return {
    ...next,
    hour: Math.floor(calendar.startTimeMinutes / 60),
    minute: calendar.startTimeMinutes % 60,
    second: 0,
  };
};

export const addBusinessDays = (
  start: Date,
  businessDays: number,
  calendar: BusinessCalendar,
) => {
  let result = getCalendarParts(start, calendar.timezone);
  let addedBusinessDays = 0;

  while (addedBusinessDays < businessDays) {
    result = addCalendarDays(result, 1);

    if (isBusinessDay(result, calendar)) {
      addedBusinessDays += 1;
    }
  }

  return toZonedInstant(result, calendar.timezone);
};

export const addBusinessMinutes = (
  start: Date,
  businessMinutes: number,
  calendar: BusinessCalendar,
) => {
  let result = getCalendarParts(start, calendar.timezone);
  let remainingMinutes = businessMinutes;

  if (!isBusinessDay(result, calendar)) {
    result = nextBusinessDayOpening(addCalendarDays(result, -1), calendar);
  }

  while (remainingMinutes > 0) {
    const currentMinutes = result.hour * 60 + result.minute;

    if (currentMinutes < calendar.startTimeMinutes) {
      result.hour = Math.floor(calendar.startTimeMinutes / 60);
      result.minute = calendar.startTimeMinutes % 60;
    }

    const adjustedMinutes = result.hour * 60 + result.minute;
    const availableMinutes = calendar.endTimeMinutes - adjustedMinutes;

    if (availableMinutes <= 0) {
      result = nextBusinessDayOpening(result, calendar);
      continue;
    }

    const minutesToAdd = Math.min(remainingMinutes, availableMinutes);
    result.minute += minutesToAdd;
    result = addCalendarDays(result, 0);
    remainingMinutes -= minutesToAdd;

    if (remainingMinutes > 0) {
      result = nextBusinessDayOpening(result, calendar);
    }
  }

  return toZonedInstant(result, calendar.timezone);
};
