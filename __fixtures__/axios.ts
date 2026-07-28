import { jest } from '@jest/globals'

export const post = jest.fn(async () => ({
    status: 200,
    statusText: 'OK',
    data: { access_token: 'iam-token' }
}))

export const get = jest.fn()
export const put = jest.fn()

export default { post, get, put }
