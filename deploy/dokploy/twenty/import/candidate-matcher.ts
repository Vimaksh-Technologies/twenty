import type {
  AgencyCandidate,
  CandidateMatchResult,
  CandidateSignal,
  ExistingAgencyCandidate,
  NormalizedAgencyInput,
} from './types.js';

const SCORE_BY_SIGNAL: Record<CandidateSignal, number> = {
  domain: 40,
  email: 50,
  name: 20,
  phone: 45,
  postcode: 10,
};

const orderedSignals: CandidateSignal[] = [
  'email',
  'domain',
  'name',
  'phone',
  'postcode',
];

const valueForSignal = (
  input: NormalizedAgencyInput,
  signal: CandidateSignal,
): string | undefined => {
  const fieldBySignal: Record<CandidateSignal, keyof NormalizedAgencyInput> = {
    domain: 'normalizedDomain',
    email: 'normalizedEmail',
    name: 'normalizedName',
    phone: 'normalizedPhone',
    postcode: 'normalizedPostcode',
  };

  return input[fieldBySignal[signal]];
};

export const matchAgencyCandidates = (
  input: NormalizedAgencyInput,
  existingAgencies: ExistingAgencyCandidate[],
): CandidateMatchResult => {
  const candidates = existingAgencies
    .map<AgencyCandidate>((existingAgency) => {
      const signals = orderedSignals.filter((signal) => {
        const inputValue = valueForSignal(input, signal);
        const candidateValue = valueForSignal(existingAgency, signal);

        return (
          inputValue !== undefined &&
          candidateValue !== undefined &&
          inputValue === candidateValue
        );
      });

      return {
        candidateId: existingAgency.id,
        score: signals.reduce(
          (total, signal) => total + SCORE_BY_SIGNAL[signal],
          0,
        ),
        signals,
      };
    })
    .filter((candidate) => candidate.signals.length > 0)
    .sort((left, right) => {
      return (
        right.score - left.score ||
        left.candidateId.localeCompare(right.candidateId)
      );
    });

  if (candidates.length === 0) {
    return {
      candidates,
      requiredDecision: true,
      status: 'no-candidate',
    };
  }

  const leadingCandidate = candidates[0];
  const secondCandidate = candidates[1];
  const isAmbiguous =
    leadingCandidate !== undefined &&
    secondCandidate !== undefined &&
    leadingCandidate.score - secondCandidate.score <= 15;

  return {
    candidates,
    requiredDecision: true,
    status: isAmbiguous ? 'ambiguous' : 'review',
  };
};
