/**
 * Stable serializer for recorded Yandex Cloud SDK request objects.
 *
 * Deliberately free of jest and SDK imports so it survives the migration from
 * `jest.mock` to `jest.unstable_mockModule` unchanged.
 */

/**
 * Keys whose values are not reproducible across runs and are replaced with a
 * fixed marker.
 *
 * `sha256` digests the zip archive, and archiver embeds file mtimes, so the
 * digest differs between checkouts. Zip *contents* are characterized by
 * `zip-sources.test.ts` instead.
 */
const REDACTED_KEYS = new Set(['sha256'])

/**
 * Normalizes a value into a form that is stable across runs and machines.
 *
 * - Buffers and byte arrays become `bytes:<length>` — the length is stable for
 *   a fixed file set even though the bytes are not.
 * - protobufjs `Long` instances become their decimal string.
 * - Dates become `date:<iso>`.
 * - Object keys are sorted so key insertion order cannot cause a false diff.
 */
export function normalize(value: unknown): unknown {
    if (value === null || value === undefined) {
        return value
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
        return `bytes:${value.length}`
    }
    if (typeof value === 'bigint') {
        return value.toString()
    }
    if (value instanceof Date) {
        return `date:${value.toISOString()}`
    }
    if (Array.isArray(value)) {
        return value.map(normalize)
    }
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>
        // protobufjs Long: has low/high/unsigned and a decimal toString().
        if ('low' in obj && 'high' in obj && 'unsigned' in obj) {
            return String(obj)
        }
        const out: Record<string, unknown> = {}
        for (const key of Object.keys(obj).sort()) {
            out[key] = REDACTED_KEYS.has(key) ? '<redacted>' : normalize(obj[key])
        }
        return out
    }
    return value
}
