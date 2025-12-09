/**
 * Utility for filtering empty glob patterns.
 *
 * @module
 */

/**
 * Filters empty strings from glob pattern array.
 *
 * @param patterns - Array of glob patterns (may contain empty strings)
 * @returns Filtered array with only non-empty patterns
 *
 * @example
 * parseIgnoreGlobPatterns(['*.log', '', 'node_modules/**', ''])
 * // Returns: ['*.log', 'node_modules/**']
 */
export function parseIgnoreGlobPatterns(patterns: string[]): string[] {
    const result: string[] = []
    for (const pattern of patterns) {
        if (pattern?.length > 0) {
            result.push(pattern)
        }
    }
    return result
}
