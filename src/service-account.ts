/**
 * Service account resolution utilities.
 *
 * Resolves service account name to ID via Yandex Cloud IAM API.
 *
 * @module
 */

import { Session } from '@yandex-cloud/nodejs-sdk'
import { serviceAccountService } from '@yandex-cloud/nodejs-sdk/iam-v1'
import { ListServiceAccountsRequest } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account_service'

/**
 * Resolves service account identifier to ID.
 *
 * Priority:
 * 1. If serviceAccountId is provided, returns it immediately
 * 2. If serviceAccountName is provided, looks up by name in folder
 * 3. Otherwise returns undefined
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param folderId - Folder to search for service account
 * @param serviceAccountId - Direct service account ID (preferred)
 * @param serviceAccountName - Service account name to resolve
 * @returns Service account ID or undefined if neither ID nor name provided
 * @throws {Error} If service account name not found in folder
 *
 * @example
 * // Returns ID immediately if provided
 * await resolveServiceAccountId(session, folderId, 'aje123abc', '')
 *
 * // Looks up by name
 * await resolveServiceAccountId(session, folderId, '', 'my-sa')
 *
 * // Returns undefined
 * await resolveServiceAccountId(session, folderId, '', '')
 */
export async function resolveServiceAccountId(
    session: Session,
    folderId: string,
    serviceAccountId: string,
    serviceAccountName: string
): Promise<string | undefined> {
    const client = session.client(serviceAccountService.ServiceAccountServiceClient)
    if (serviceAccountId) {
        return serviceAccountId
    }
    if (serviceAccountName) {
        const { serviceAccounts } = await client.list(
            ListServiceAccountsRequest.fromPartial({
                folderId,
                filter: `name = "${serviceAccountName}"`
            })
        )

        if (serviceAccounts.length === 0) {
            throw new Error(`Service account with name ${serviceAccountName} not found`)
        }
        return serviceAccounts[0].id
    }
    return undefined
}
