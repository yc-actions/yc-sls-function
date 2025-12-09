/**
 * Parser for Yandex Lockbox secret references.
 *
 * Converts secret references into structured Secret objects for function configuration.
 *
 * @module
 */

/**
 * Lockbox secret reference for environment variable injection.
 */
export type Secret = {
    /** Environment variable name to inject secret value into */
    environmentVariable: string

    /** Lockbox secret ID */
    id: string

    /** Secret version ID or 'latest' for current version */
    versionId: string

    /** Key within secret payload to extract */
    key: string
}

/**
 * Parses Lockbox secret references from input strings.
 *
 * @param secrets - Array of secret references in format: `ENV_VAR=secret-id/version-id/key`
 * @returns Array of parsed Secret objects
 * @throws {Error} If reference format is invalid or missing required parts
 *
 * @example
 * parseLockboxVariables([
 *   'DB_PASSWORD=e6q123abc/latest/password',
 *   'API_KEY=e6q456def/v1/api_key'
 * ])
 */
export function parseLockboxVariables(secrets: string[]): Secret[] {
    const secretsArr: Secret[] = []
    for (const line of secrets) {
        const [environmentVariable, values] = line.split('=')
        const [id, versionId, key] = values.split('/')
        if (!environmentVariable || !id || !key || !versionId) {
            throw new Error(`Broken reference to Lockbox Secret: ${line}`)
        }
        const secret = { environmentVariable, id, versionId, key }
        secretsArr.push(secret)
    }
    return secretsArr
}
