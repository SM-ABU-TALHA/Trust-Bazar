export type ClassValue = string | null | undefined | false | 0;

/** Tiny class-name joiner — avoids a dependency for the UI kit. */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(' ');
}
