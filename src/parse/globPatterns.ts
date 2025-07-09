// Parse ignore glob patterns from input array
export function parseIgnoreGlobPatterns(patterns: string[]): string[] {
    const result: string[] = []
    for (const pattern of patterns) {
        if (pattern?.length > 0) {
            result.push(pattern)
        }
    }
    return result
}
