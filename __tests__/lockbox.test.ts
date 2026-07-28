import { jest } from '@jest/globals'
import { Secret as LockboxSecret } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret'
import type { Secret } from '../src/parse/index.js'

import * as core from '../__fixtures__/core.js'
import * as sdk from '../__fixtures__/yandex-sdk/index.js'
import {
    __setGetSecretFail,
    __setListFailure,
    __setListPageSize,
    __setLockboxVersions,
    __setSecretList,
    __setUnknownSecretIds,
    LockboxSecretServiceMock,
    secretService
} from '../__fixtures__/yandex-sdk/lockbox-v1.js'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@yandex-cloud/nodejs-sdk', () => sdk)
jest.unstable_mockModule('@yandex-cloud/nodejs-sdk/lockbox-v1', () => ({ secretService }))

const { Session } = await import('@yandex-cloud/nodejs-sdk')
const { resolveLatestLockboxVersions } = await import('../src/lockbox.js')

/** Builds a Lockbox secret as returned by SecretService.List. */
function lockboxSecret(id: string, name: string, currentVersionId?: string): LockboxSecret {
    return {
        id,
        folderId: 'folderid',
        createdAt: new Date('2024-01-01T00:00:00Z'),
        name,
        description: '',
        labels: {},
        status: 1,
        kmsKeyId: '',
        deletionProtection: false,
        currentVersion: currentVersionId
            ? {
                  id: currentVersionId,
                  secretId: id,
                  createdAt: new Date('2024-01-01T00:00:00Z'),
                  description: '',
                  status: 1,
                  payloadEntryKeys: []
              }
            : undefined
    }
}

/** Points SecretService.Get at a single current version. */
function currentVersion(id: string): void {
    __setLockboxVersions([
        {
            id,
            secretId: '',
            createdAt: new Date('2024-01-01T00:00:00Z'),
            description: '',
            status: 1,
            payloadEntryKeys: []
        }
    ])
}

describe('resolveLatestLockboxVersions', () => {
    let session: InstanceType<typeof Session>

    beforeEach(() => {
        __setGetSecretFail(false)
        __setUnknownSecretIds([])
        __setSecretList([])
        __setLockboxVersions([])
        __setListPageSize(0)
        __setListFailure('')
        session = new Session({})
    })

    it('leaves secrets alone when none ask for latest', async () => {
        const secrets: Secret[] = [{ environmentVariable: 'ENV1', id: 'secretid', versionId: 'verid', key: 'key1' }]

        const resolved = await resolveLatestLockboxVersions(session, 'folderid', secrets)

        expect(resolved).toEqual(secrets)
        expect(LockboxSecretServiceMock.get).not.toHaveBeenCalled()
        expect(LockboxSecretServiceMock.list).not.toHaveBeenCalled()
    })

    it('resolves latest to the current version id', async () => {
        currentVersion('version123')
        const secrets: Secret[] = [{ environmentVariable: 'ENV1', id: 'secretid', versionId: 'latest', key: 'key1' }]

        const resolved = await resolveLatestLockboxVersions(session, 'folderid', secrets)

        expect(resolved).toEqual([
            { environmentVariable: 'ENV1', id: 'secretid', versionId: 'version123', key: 'key1' }
        ])
        // Happy path never needs the folder listing.
        expect(LockboxSecretServiceMock.list).not.toHaveBeenCalled()
    })

    it('preserves order and passes through secrets pinned to a version', async () => {
        currentVersion('version123')
        const secrets: Secret[] = [
            { environmentVariable: 'ENV1', id: 'secret1', versionId: 'latest', key: 'key1' },
            { environmentVariable: 'ENV2', id: 'secret2', versionId: 'version2', key: 'key2' },
            { environmentVariable: 'ENV3', id: 'secret3', versionId: 'latest', key: 'key3' }
        ]

        const resolved = await resolveLatestLockboxVersions(session, 'folderid', secrets)

        expect(resolved.map(s => [s.environmentVariable, s.versionId])).toEqual([
            ['ENV1', 'version123'],
            ['ENV2', 'version2'],
            ['ENV3', 'version123']
        ])
    })

    it('resolves every entry when one secret is referenced by several keys', async () => {
        currentVersion('version999')
        const secrets: Secret[] = [
            { environmentVariable: 'DATABASE_URL', id: 'secret1', versionId: 'latest', key: 'DATABASE_URL' },
            { environmentVariable: 'API_KEY', id: 'secret1', versionId: 'latest', key: 'API_KEY' }
        ]

        const resolved = await resolveLatestLockboxVersions(session, 'folderid', secrets)

        expect(resolved.map(s => s.versionId)).toEqual(['version999', 'version999'])
        // One secret, one lookup - keys referencing the same secret share it.
        expect(LockboxSecretServiceMock.get).toHaveBeenCalledTimes(1)
    })

    it('falls back to name lookup and rewrites the id when get fails', async () => {
        __setGetSecretFail(true)
        __setSecretList([lockboxSecret('realsecretid', 'my-secret', 'version123')])
        const secrets: Secret[] = [{ environmentVariable: 'ENV1', id: 'my-secret', versionId: 'latest', key: 'key1' }]

        const resolved = await resolveLatestLockboxVersions(session, 'folderid', secrets)

        expect(resolved).toEqual([
            { environmentVariable: 'ENV1', id: 'realsecretid', versionId: 'version123', key: 'key1' }
        ])
    })

    it('pages through the folder listing to find a secret by name', async () => {
        __setGetSecretFail(true)
        __setListPageSize(1)
        __setSecretList([
            lockboxSecret('id-a', 'secret-a', 'version-a'),
            lockboxSecret('id-b', 'secret-b', 'version-b'),
            lockboxSecret('id-c', 'secret-c', 'version-c')
        ])
        const secrets: Secret[] = [{ environmentVariable: 'ENV1', id: 'secret-c', versionId: 'latest', key: 'key1' }]

        const resolved = await resolveLatestLockboxVersions(session, 'folderid', secrets)

        expect(resolved).toEqual([{ environmentVariable: 'ENV1', id: 'id-c', versionId: 'version-c', key: 'key1' }])
        expect(LockboxSecretServiceMock.list).toHaveBeenCalledTimes(3)
    })

    it('stops paging once every wanted name is found', async () => {
        __setGetSecretFail(true)
        __setListPageSize(1)
        __setSecretList([
            lockboxSecret('id-a', 'secret-a', 'version-a'),
            lockboxSecret('id-b', 'secret-b', 'version-b'),
            lockboxSecret('id-c', 'secret-c', 'version-c')
        ])
        const secrets: Secret[] = [{ environmentVariable: 'ENV1', id: 'secret-a', versionId: 'latest', key: 'key1' }]

        const resolved = await resolveLatestLockboxVersions(session, 'folderid', secrets)

        expect(resolved).toEqual([{ environmentVariable: 'ENV1', id: 'id-a', versionId: 'version-a', key: 'key1' }])
        // The match is on the first page, so the remaining pages are never fetched.
        expect(LockboxSecretServiceMock.list).toHaveBeenCalledTimes(1)
    })

    it('mixes id-resolved and name-resolved references in one run', async () => {
        currentVersion('version123')
        __setUnknownSecretIds(['by-name'])
        __setSecretList([lockboxSecret('realsecretid', 'by-name', 'version456')])
        const secrets: Secret[] = [
            { environmentVariable: 'ENV1', id: 'by-id', versionId: 'latest', key: 'key1' },
            { environmentVariable: 'ENV2', id: 'by-name', versionId: 'latest', key: 'key2' }
        ]

        const resolved = await resolveLatestLockboxVersions(session, 'folderid', secrets)

        expect(resolved).toEqual([
            { environmentVariable: 'ENV1', id: 'by-id', versionId: 'version123', key: 'key1' },
            { environmentVariable: 'ENV2', id: 'realsecretid', versionId: 'version456', key: 'key2' }
        ])
    })

    it('lists the folder once for a batch of failed lookups', async () => {
        __setGetSecretFail(true)
        __setSecretList([
            lockboxSecret('id-a', 'secret-a', 'version-a'),
            lockboxSecret('id-b', 'secret-b', 'version-b')
        ])
        const secrets: Secret[] = [
            { environmentVariable: 'ENV1', id: 'secret-a', versionId: 'latest', key: 'key1' },
            { environmentVariable: 'ENV2', id: 'secret-b', versionId: 'latest', key: 'key2' }
        ]

        const resolved = await resolveLatestLockboxVersions(session, 'folderid', secrets)

        expect(resolved.map(s => s.id)).toEqual(['id-a', 'id-b'])
        expect(LockboxSecretServiceMock.list).toHaveBeenCalledTimes(1)
    })

    it('throws when a secret found by id has no current version', async () => {
        __setLockboxVersions([])
        const secrets: Secret[] = [{ environmentVariable: 'ENV1', id: 'secretid', versionId: 'latest', key: 'key1' }]

        await expect(resolveLatestLockboxVersions(session, 'folderid', secrets)).rejects.toThrow(
            'Failed to resolve latest versions for secrets: Secret secretid has no current version'
        )
    })

    it('throws when a secret found by name has no current version', async () => {
        __setGetSecretFail(true)
        __setSecretList([lockboxSecret('realsecretid', 'my-secret')])
        const secrets: Secret[] = [{ environmentVariable: 'ENV1', id: 'my-secret', versionId: 'latest', key: 'key1' }]

        await expect(resolveLatestLockboxVersions(session, 'folderid', secrets)).rejects.toThrow(
            'Secret my-secret (found as realsecretid) has no current version'
        )
    })

    it('throws naming every secret that resolved by neither id nor name', async () => {
        __setGetSecretFail(true)
        __setSecretList([lockboxSecret('id-a', 'secret-a', 'version-a')])
        const secrets: Secret[] = [
            { environmentVariable: 'ENV1', id: 'secret-a', versionId: 'latest', key: 'key1' },
            { environmentVariable: 'ENV2', id: 'missing-1', versionId: 'latest', key: 'key2' },
            { environmentVariable: 'ENV3', id: 'missing-2', versionId: 'latest', key: 'key3' }
        ]

        await expect(resolveLatestLockboxVersions(session, 'folderid', secrets)).rejects.toThrow(
            'Failed to resolve latest versions for secrets: ' +
                'secret "missing-1" is not a known id (Secret not found) and no secret with that name exists in folder folderid; ' +
                'secret "missing-2" is not a known id (Secret not found) and no secret with that name exists in folder folderid'
        )
    })

    it('keeps the id lookup failure in the message when the name lookup finds nothing', async () => {
        // A transient Get failure looks exactly like a name to the first stage - the
        // reported error has to carry why the id lookup failed, or it misdirects.
        __setGetSecretFail(true)
        __setSecretList([])
        const secrets: Secret[] = [
            { environmentVariable: 'ENV1', id: 'maybe-a-name', versionId: 'latest', key: 'key1' }
        ]

        await expect(resolveLatestLockboxVersions(session, 'folderid', secrets)).rejects.toThrow(
            'secret "maybe-a-name" is not a known id (Secret not found) and no secret with that name exists in folder folderid'
        )
    })

    it('explains which role is missing when the folder listing is denied', async () => {
        __setGetSecretFail(true)
        __setListFailure('Permission denied')
        const secrets: Secret[] = [
            { environmentVariable: 'ENV1', id: 'my-secret', versionId: 'latest', key: 'key1' },
            { environmentVariable: 'ENV2', id: 'other-secret', versionId: 'latest', key: 'key2' }
        ]

        await expect(resolveLatestLockboxVersions(session, 'folderid', secrets)).rejects.toThrow(
            'Failed to list secrets in folder folderid while resolving 2 secret(s) by name: Permission denied. ' +
                'Grant lockbox.viewer on the folder to the credentials the action authenticates with, ' +
                'or reference the secrets by id.'
        )
    })

    it('resolves more secrets than the concurrency limit', async () => {
        currentVersion('version123')
        const secrets: Secret[] = Array.from({ length: 12 }, (_, i) => ({
            environmentVariable: `ENV${i}`,
            id: `secret${i}`,
            versionId: 'latest',
            key: `key${i}`
        }))

        const resolved = await resolveLatestLockboxVersions(session, 'folderid', secrets)

        expect(resolved).toHaveLength(12)
        expect(resolved.every(s => s.versionId === 'version123')).toBe(true)
        expect(LockboxSecretServiceMock.get).toHaveBeenCalledTimes(12)
    })
})
