export const KB = 1024;
export const MB = 1024 * KB;
export const GB = 1024 * MB;

export function parseMemory(input: string): number {
  const match = input.match(/^(\d+)\s?(mb|gb)$/i);
  if (!match) {
    throw new Error('memory has unknown format');
  }
  const digits = parseInt(match[1], 10);
  const multiplier = match[2].toLowerCase() === 'mb' ? MB : GB;
  return digits * multiplier;
}
