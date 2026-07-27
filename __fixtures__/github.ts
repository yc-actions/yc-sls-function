import { jest } from '@jest/globals'

export const context = {
    get repo() {
        return { owner: 'some-owner', repo: 'some-repo' }
    }
}

export const getOctokit = jest.fn()
