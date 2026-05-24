/**
 * Formats a user name for display.
 * @param first - First name
 * @param last - Last name
 * @returns Full name string
 */
export function formatName(first: string, last: string): string {
  return `${first} ${last}`;
}

export const MAX_RETRIES = 3;

export const calculateSum = (a: number, b: number): number => a + b;
