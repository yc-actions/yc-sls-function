import { jest } from '@jest/globals'
import { errors } from '@yandex-cloud/nodejs-sdk'

// Real error classes - src/main.ts does `err instanceof errors.ApiError`.
export { errors }

export const Session = jest.fn().mockImplementation(() => ({
    client: (service: new () => unknown) => new service()
}))

// The fixtures return already-finished operations, so waiting is identity.
export const waitForOperation = jest.fn((op: unknown) => op)
