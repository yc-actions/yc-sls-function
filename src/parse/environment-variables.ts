/**
 * Parser for environment variable specifications.
 *
 * Converts KEY=value strings to object map.
 *
 * @module
 */

/**
 * Parses environment variables from input array to key-value map.
 *
 * @param env - Array of strings in format: `KEY=value`
 * @returns Object map of environment variables
 *
 * @example
 * parseEnvironmentVariables([
 *   'NODE_ENV=production',
 *   'API_URL=https://api.example.com',
 *   'DEBUG=true'
 * ])
 * // Returns: { NODE_ENV: 'production', API_URL: 'https://...', DEBUG: 'true' }
 *
 * @remarks
 * Values can contain '=' characters. Only first '=' is treated as separator.
 */
export function parseEnvironmentVariables(env: string[]): { [s: string]: string } {
    const environment: { [key: string]: string } = {}
    for (const line of env) {
        const [key, value] = line.split(/=(.*)/s)
        environment[key.trim()] = value.trim()
    }
    return environment
}
