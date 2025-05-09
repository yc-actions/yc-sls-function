import { serviceClients, Session } from '@yandex-cloud/nodejs-sdk'
import { ListServiceAccountsRequest } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/iam/v1/service_account_service'

export async function resolveServiceAccountId(
    session: Session,
    folderId: string,
    serviceAccountId: string,
    serviceAccountName: string
): Promise<string | undefined> {
    const client = session.client(serviceClients.ServiceAccountServiceClient)
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
