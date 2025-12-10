import { describe, expect, it, beforeEach } from '@jest/globals'
import { Session } from '@yandex-cloud/nodejs-sdk'
import { Secret } from '../src/parse'
import {
    __setSecretList,
    __setLockboxVersions,
    __setGetSecretFail
} from './__mocks__/@yandex-cloud/nodejs-sdk/lockbox-v1'
import { Secret as LockboxSecret } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/lockbox/v1/secret'
import { resolveLatestLockboxVersions } from '../src/main'

describe('resolveLatestLockboxVersions', () => {
    beforeEach(() => {
        // Reset mocks before each test
        __setGetSecretFail(false)
        __setSecretList([])
        __setLockboxVersions([])
    })

    it('should resolve "latest" to a specific version ID', async () => {
        const secrets: Secret[] = [{ id: 'secret1', versionId: 'latest', key: 'key1', environmentVariable: 'ENV1' }]
        const lockboxSecrets: LockboxSecret[] = [
            {
                id: 'secret1',
                folderId: 'folder1',
                name: 'secret1',
                description: 'test secret',
                labels: {},
                status: 1,
                kmsKeyId: 'key1',
                deletionProtection: false,
                currentVersion: {
                    id: 'version123',
                    secretId: 'secret1',
                    description: 'current version',
                    status: 1,
                    payloadEntryKeys: []
                }
            }
        ]
        __setSecretList(lockboxSecrets)
        __setLockboxVersions([
            {
                id: 'version123',
                secretId: 'secret1',
                createdAt: new Date('2024-01-01'),
                description: 'current version',
                status: 1,
                payloadEntryKeys: []
            }
        ])

        const session = new Session({})
        const resolved = await resolveLatestLockboxVersions(session, 'folder1', secrets)

        expect(resolved[0].versionId).toBe('version123')
    })

    it('should throw an error if some secrets are not found', async () => {
        __setGetSecretFail(true)
        const secrets: Secret[] = [
            { id: 'foundSecret', versionId: 'latest', key: 'key1', environmentVariable: 'ENV1' },
            { id: 'missingSecret', versionId: 'latest', key: 'key2', environmentVariable: 'ENV2' }
        ]
        const lockboxSecrets: LockboxSecret[] = [
            {
                id: 'realSecretId',
                folderId: 'folder1',
                name: 'foundSecret',
                description: 'test secret',
                labels: {},
                status: 1,
                kmsKeyId: 'key1',
                deletionProtection: false,
                currentVersion: {
                    id: 'version123',
                    secretId: 'realSecretId',
                    description: 'current version',
                    status: 1,
                    payloadEntryKeys: []
                }
            }
        ]
        __setSecretList(lockboxSecrets)

        const session = new Session({})
        await expect(resolveLatestLockboxVersions(session, 'folder1', secrets)).rejects.toThrow(
            'Failed to resolve latest versions for secrets: Failed to resolve secret: missingSecret'
        )
    })

    it('should resolve "latest" to a specific version ID by secret name if ID lookup fails', async () => {
        __setGetSecretFail(true)
        const secrets: Secret[] = [{ id: 'secretName', versionId: 'latest', key: 'key1', environmentVariable: 'ENV1' }]
        const lockboxSecrets: LockboxSecret[] = [
            {
                id: 'realSecretId',
                folderId: 'folder1',
                name: 'secretName',
                description: 'test secret',
                labels: {},
                status: 1,
                kmsKeyId: 'key1',
                deletionProtection: false,
                currentVersion: {
                    id: 'version123',
                    secretId: 'realSecretId',
                    description: 'current version',
                    status: 1,
                    payloadEntryKeys: []
                }
            }
        ]
        __setSecretList(lockboxSecrets)

        const session = new Session({})
        const resolved = await resolveLatestLockboxVersions(session, 'folder1', secrets)

        expect(resolved[0].versionId).toBe('version123')
        expect(resolved[0].id).toBe('realSecretId')
    })

    it('should do nothing if no "latest" version is present', async () => {
        const secrets: Secret[] = [{ id: 'secret1', versionId: 'version1', key: 'key1', environmentVariable: 'ENV1' }]
        const session = new Session({})
        const resolved = await resolveLatestLockboxVersions(session, 'folder1', secrets)

        expect(resolved).toEqual(secrets)
    })

    it('should throw error if secret has no current version', async () => {
        const secrets: Secret[] = [{ id: 'secret1', versionId: 'latest', key: 'key1', environmentVariable: 'ENV1' }]
        const lockboxSecrets: LockboxSecret[] = [
            {
                id: 'secret1',
                folderId: 'folder1',
                name: 'secret1',
                description: 'test secret',
                labels: {},
                status: 1,
                kmsKeyId: 'key1',
                deletionProtection: false
                // Note: no currentVersion property
            }
        ]
        __setSecretList(lockboxSecrets)
        __setLockboxVersions([])

        const session = new Session({})
        await expect(resolveLatestLockboxVersions(session, 'folder1', secrets)).rejects.toThrow(
            'Secret secret1 has no current version'
        )
    })

    it('should handle multiple secrets with mixed resolution needs', async () => {
        const secrets: Secret[] = [
            { id: 'secret1', versionId: 'latest', key: 'key1', environmentVariable: 'ENV1' },
            { id: 'secret2', versionId: 'version2', key: 'key2', environmentVariable: 'ENV2' }
        ]
        const lockboxSecrets: LockboxSecret[] = [
            {
                id: 'secret1',
                folderId: 'folder1',
                name: 'secret1',
                description: 'test secret',
                labels: {},
                status: 1,
                kmsKeyId: 'key1',
                deletionProtection: false,
                currentVersion: {
                    id: 'version123',
                    secretId: 'secret1',
                    description: 'current version',
                    status: 1,
                    payloadEntryKeys: []
                }
            }
        ]
        __setSecretList(lockboxSecrets)
        __setLockboxVersions([
            {
                id: 'version123',
                secretId: 'secret1',
                createdAt: new Date('2024-01-01'),
                description: 'current version',
                status: 1,
                payloadEntryKeys: []
            }
        ])

        const session = new Session({})
        const resolved = await resolveLatestLockboxVersions(session, 'folder1', secrets)

        expect(resolved.find(s => s.id === 'secret1')?.versionId).toBe('version123')
        expect(resolved.find(s => s.id === 'secret2')?.versionId).toBe('version2')
    })

    it('should handle multiple secrets with duplicate keys', async () => {
        const secrets: Secret[] = [
            { id: 'secret1', versionId: 'latest', key: 'DATABASE_URL', environmentVariable: 'DATABASE_URL' },
            { id: 'secret1', versionId: 'latest', key: 'API_KEY', environmentVariable: 'API_KEY' }
        ]
        const lockboxSecrets: LockboxSecret[] = [
            {
                id: 'secret1',
                folderId: 'folder1',
                name: 'secret1',
                description: 'test secret',
                labels: {},
                status: 1,
                kmsKeyId: 'key1',
                deletionProtection: false,
                currentVersion: {
                    id: 'version999',
                    secretId: 'secret1',
                    description: 'current version',
                    status: 1,
                    payloadEntryKeys: ['DATABASE_URL', 'API_KEY']
                }
            }
        ]
        __setSecretList(lockboxSecrets)
        __setLockboxVersions([
            {
                id: 'version999',
                secretId: 'secret1',
                createdAt: new Date('2024-01-01'),
                description: 'current version',
                status: 1,
                payloadEntryKeys: ['DATABASE_URL', 'API_KEY']
            }
        ])

        const session = new Session({})
        const resolved = await resolveLatestLockboxVersions(session, 'folder1', secrets)

        // Verify that both secrets referencing the same ID but different keys are resolved
        expect(resolved.find(s => s.environmentVariable === 'DATABASE_URL')?.versionId).toBe('version999')
        expect(resolved.find(s => s.environmentVariable === 'API_KEY')?.versionId).toBe('version999')
    })
})
