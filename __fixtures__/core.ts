import type * as core from '@actions/core'
import { jest } from '@jest/globals'

export const debug = jest.fn<typeof core.debug>()
export const error = jest.fn<typeof core.error>()
export const info = jest.fn<typeof core.info>()
export const warning = jest.fn<typeof core.warning>()
export const startGroup = jest.fn<typeof core.startGroup>()
export const endGroup = jest.fn<typeof core.endGroup>()
export const setCommandEcho = jest.fn<typeof core.setCommandEcho>()
export const getInput = jest.fn<typeof core.getInput>()
export const getMultilineInput = jest.fn<typeof core.getMultilineInput>()
export const getBooleanInput = jest.fn<typeof core.getBooleanInput>()
/**
 * Resolves to a token by default: the WIF code path in `src/main.ts` throws
 * `No credentials provided` on a falsy token, so a bare `jest.fn()` would change
 * behavior for the workload-identity-federation scenarios.
 */
export const getIDToken = jest.fn<typeof core.getIDToken>(async () => 'github-token')
export const setOutput = jest.fn<typeof core.setOutput>()
export const setFailed = jest.fn<typeof core.setFailed>()

export const addHeading = jest.fn().mockReturnThis()
export const addList = jest.fn().mockReturnThis()
export const write = jest.fn(async () => undefined)

/** Mirrors core.summary's chainable builder. */
export const summary = { addHeading, addList, write }
