/** Pure helpers to read back kept values field by field (design 027 E5) – no Angular. */
export function record(v: unknown): Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function boolOr(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function textOr(v: unknown, fallback: string, max = 2000): string {
  return typeof v === 'string' && v.length <= max ? v : fallback;
}

export function intOr(v: unknown, fallback: number, min: number, max: number): number {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max
    ? (v as number)
    : fallback;
}

export function oneOf<T extends string | number>(v: unknown, values: readonly T[], fallback: T): T {
  return values.includes(v as T) ? (v as T) : fallback;
}
