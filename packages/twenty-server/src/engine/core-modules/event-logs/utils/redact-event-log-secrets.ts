const REDACTION_SENTINEL = '[REDACTED]';
const SENSITIVE_EVENT_PROPERTY_KEY =
  /(?:password|passwd|pwd|token|secret|authorization|api[_-]?key|private[_-]?key|client[_-]?secret|access[_-]?key|credential)s?$/i;
const CLASSIFIED_EVENT_PROPERTY_KEY =
  /^(?:before|after|body|htmlBody|textBody|emailBody|messageBody|content|documentContent|attachmentContent|fileContent|rawContent|rawData|rawPayload)$/i;
const AUTHORIZATION_VALUE =
  /(\bauthorization\s*[:=]\s*)(?:(bearer|basic)\s+)?(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi;
const CREDENTIAL_ASSIGNMENT =
  /(\b(?:password|passwd|pwd|token|secret|api[_ -]?key|private[_ -]?key|client[_ -]?secret|access[_ -]?key|credential)s?\b\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;&]+)/gi;
const URL_PASSWORD = /(\b[a-z][a-z0-9+.-]*:\/\/[^:\s/@]+:)([^@\s/]+)(@)/gi;
const JSON_WEB_TOKEN =
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const PRIVATE_KEY =
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;

const redactCredentialBearingMessage = (message: string): string =>
  message
    .replace(
      AUTHORIZATION_VALUE,
      (_match, prefix: string, scheme: string | undefined) =>
        `${prefix}${scheme === undefined ? '' : `${scheme} `}${REDACTION_SENTINEL}`,
    )
    .replace(CREDENTIAL_ASSIGNMENT, `$1${REDACTION_SENTINEL}`)
    .replace(URL_PASSWORD, `$1${REDACTION_SENTINEL}$3`)
    .replace(JSON_WEB_TOKEN, REDACTION_SENTINEL)
    .replace(AWS_ACCESS_KEY, REDACTION_SENTINEL)
    .replace(PRIVATE_KEY, REDACTION_SENTINEL);

export const redactEventLogSecrets = <TValue>(value: TValue): TValue => {
  if (typeof value === 'string') {
    return redactCredentialBearingMessage(value) as TValue;
  }

  if (Array.isArray(value)) {
    return value.map(redactEventLogSecrets) as TValue;
  }

  if (value === null || typeof value !== 'object' || value instanceof Date) {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      SENSITIVE_EVENT_PROPERTY_KEY.test(key) ||
      CLASSIFIED_EVENT_PROPERTY_KEY.test(key)
        ? REDACTION_SENTINEL
        : redactEventLogSecrets(nestedValue),
    ]),
  ) as TValue;
};
