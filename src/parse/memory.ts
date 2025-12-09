/**
 * Parser for memory size specifications.
 *
 * Converts human-readable memory strings (e.g., '128Mb', '1Gb') to bytes.
 *
 * @module
 */

/** 1 kilobyte = 1024 bytes */
export const KB = 1024

/** 1 megabyte = 1024 KB */
export const MB = 1024 * KB

/** 1 gigabyte = 1024 MB */
export const GB = 1024 * MB

/**
 * Parses memory size from string to bytes.
 *
 * @param input - Memory size string (case-insensitive)
 * @returns Memory size in bytes
 * @throws {Error} If format is invalid
 *
 * @example
 * parseMemory('128Mb')  // Returns 134217728
 * parseMemory('1GB')    // Returns 1073741824
 * parseMemory('256 mb') // Returns 268435456
 */
export function parseMemory(input: string): number {
    const match = input.match(/^(\d+)\s?(mb|gb)$/i)
    if (!match) {
        throw new Error('memory has unknown format')
    }
    const digits = parseInt(match[1], 10)
    const multiplier = match[2].toLowerCase() === 'mb' ? MB : GB
    return digits * multiplier
}
