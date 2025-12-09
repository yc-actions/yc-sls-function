/**
 * Parser and validator for Yandex Cloud service account JSON key files.
 *
 * Validates required fields and transforms to internal representation.
 *
 * @module
 */

/**
 * Service account JSON key file structure from Yandex Cloud.
 *
 * @see {@link https://cloud.yandex.com/docs/iam/operations/sa/create-key}
 */
export interface ServiceAccountJsonFileContents {
    id: string
    created_at: string
    key_algorithm: string
    service_account_id: string
    private_key: string
    public_key: string
}

/**
 * Internal service account configuration for SDK authentication.
 */
export type ServiceAccountJson = {
    accessKeyId: string
    privateKey: string
    serviceAccountId: string
}

/**
 * Parses and validates service account JSON key file.
 *
 * @param val - Raw JSON string from action input
 * @returns Validated service account configuration
 * @throws {Error} If JSON is invalid or required fields are missing
 *
 * @example
 * const saJson = parseServiceAccountJsonFile(jsonString)
 * // Validates presence of: id, private_key, service_account_id
 */
export function parseServiceAccountJsonFile(val: string): ServiceAccountJson {
    const data: ServiceAccountJsonFileContents = JSON.parse(val)
    const requiredFields = ['id', 'private_key', 'service_account_id']
    const missingFields: string[] = []

    for (const field of requiredFields) {
        if (!Object.prototype.hasOwnProperty.call(data, field)) {
            missingFields.push(field)
        }
    }

    if (missingFields.length > 0) {
        const missingFieldsString = missingFields.join(', ')
        throw new Error(
            `Service Account key provided in "yc-sa-json-credentials" is missing required fields: ${missingFieldsString}`
        )
    }

    return {
        accessKeyId: data.id,
        privateKey: data.private_key,
        serviceAccountId: data.service_account_id
    }
}
