import { parseServiceAccountJsonFile, ServiceAccountJsonFileContents } from '../src/parse'

describe('fromServiceAccountJsonFile', () => {
    it('should return an object with the same values when all required fields are present', () => {
        const data: ServiceAccountJsonFileContents = {
            id: 'test_id',
            created_at: 'test_created_at',
            key_algorithm: 'test_key_algorithm',
            service_account_id: 'test_service_account_id',
            private_key: 'test_private_key',
            public_key: 'test_public_key'
        }

        const result = parseServiceAccountJsonFile(JSON.stringify(data))

        expect(result).toEqual({
            accessKeyId: 'test_id',
            privateKey: 'test_private_key',
            serviceAccountId: 'test_service_account_id'
        })
    })

    it('should throw an error when a required field is missing', () => {
        const data: Partial<ServiceAccountJsonFileContents> = {
            id: 'test_id',
            created_at: 'test_created_at',
            key_algorithm: 'test_key_algorithm',
            public_key: 'test_public_key'
        }

        expect(() => parseServiceAccountJsonFile(JSON.stringify(data))).toThrow(
            'Service Account key provided in "yc-sa-json-credentials" is missing required fields: private_key, service_account_id'
        )
    })
})
