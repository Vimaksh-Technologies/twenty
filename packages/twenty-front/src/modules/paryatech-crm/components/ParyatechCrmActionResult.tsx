import { styled } from '@linaria/react';
import { themeCssVariables } from 'twenty-ui/theme-constants';

const StyledResult = styled.div<{ error: boolean }>`
  color: ${({ error }) =>
    error ? themeCssVariables.color.red : themeCssVariables.color.green};
  font-size: ${themeCssVariables.font.size.sm};
`;

type ParyatechCrmActionResultProps = {
  message: string;
  error?: boolean;
};

export const ParyatechCrmActionResult = ({
  message,
  error = false,
}: ParyatechCrmActionResultProps) => (
  <StyledResult error={error} role={error ? 'alert' : 'status'}>
    {message}
  </StyledResult>
);
