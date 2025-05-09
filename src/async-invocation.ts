import { ActionInputs } from './actionInputs'
import {
    AsyncInvocationConfig,
    AsyncInvocationConfig_ResponseTarget
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'
import { resolveServiceAccountId } from './service-account'
import { Session } from '@yandex-cloud/nodejs-sdk'

export function isAsync(actionInputs: ActionInputs): boolean {
    return actionInputs.async
}

export function validateAsync(actionInputs: ActionInputs): boolean {
    if (!isAsync(actionInputs)) {
        return true
    }

    // either asyncSuccessSaId or asyncSuccessSaName must be set if asyncSuccessYmqArn is set
    if (actionInputs.asyncSuccessYmqArn) {
        if (!actionInputs.asyncSuccessSaId && !actionInputs.asyncSuccessSaName) {
            throw new Error(
                'Either async-success-sa-id or async-success-sa-name must be set if async-success-ymq-arn is set'
            )
        }
        // but not both
        if (actionInputs.asyncSuccessSaId && actionInputs.asyncSuccessSaName) {
            throw new Error('Either async-success-sa-id or async-success-sa-name must be set, but not both')
        }
    }
    // either asyncFailureSaId or asyncFailureSaName must be set if asyncFailureYmqArn is set
    if (actionInputs.asyncFailureYmqArn) {
        if (!actionInputs.asyncFailureSaId && !actionInputs.asyncFailureSaName) {
            throw new Error(
                'Either async-failure-sa-id or async-failure-sa-name must be set if async-failure-ymq-arn is set'
            )
        }
        // but not both
        if (actionInputs.asyncFailureSaId && actionInputs.asyncFailureSaName) {
            throw new Error('Either async-failure-sa-id or async-failure-sa-name must be set, but not both')
        }
    }

    return true
}

export async function createAsyncInvocationConfig(
    session: Session,
    actionInputs: ActionInputs
): Promise<AsyncInvocationConfig | undefined> {
    if (!isAsync(actionInputs)) {
        return undefined
    }

    let successTarget: AsyncInvocationConfig_ResponseTarget
    let failureTarget: AsyncInvocationConfig_ResponseTarget

    if (actionInputs.asyncSuccessYmqArn) {
        let serviceAccountId: string | undefined = actionInputs.asyncSuccessSaId
        if (!serviceAccountId && actionInputs.asyncSuccessSaName) {
            serviceAccountId = await resolveServiceAccountId(
                session,
                actionInputs.folderId,
                actionInputs.asyncSuccessSaId,
                actionInputs.asyncSuccessSaName
            )
        }

        successTarget = AsyncInvocationConfig_ResponseTarget.fromPartial({
            ymqTarget: {
                queueArn: actionInputs.asyncSuccessYmqArn,
                serviceAccountId
            }
        })
    } else {
        successTarget = AsyncInvocationConfig_ResponseTarget.fromPartial({
            emptyTarget: {}
        })
    }

    if (actionInputs.asyncFailureYmqArn) {
        let serviceAccountId: string | undefined = actionInputs.asyncFailureSaId
        if (!serviceAccountId && actionInputs.asyncFailureSaName) {
            serviceAccountId = await resolveServiceAccountId(
                session,
                actionInputs.folderId,
                actionInputs.asyncFailureSaId,
                actionInputs.asyncFailureSaName
            )
        }

        failureTarget = AsyncInvocationConfig_ResponseTarget.fromPartial({
            ymqTarget: {
                queueArn: actionInputs.asyncFailureYmqArn,
                serviceAccountId
            }
        })
    } else {
        failureTarget = AsyncInvocationConfig_ResponseTarget.fromPartial({
            emptyTarget: {}
        })
    }

    let serviceAccountId = await resolveServiceAccountId(
        session,
        actionInputs.folderId,
        actionInputs.asyncSaId,
        actionInputs.asyncSaName
    )
    if (serviceAccountId === undefined) {
        serviceAccountId = await resolveServiceAccountId(
            session,
            actionInputs.folderId,
            actionInputs.serviceAccount,
            actionInputs.serviceAccountName
        )
    }

    return AsyncInvocationConfig.fromPartial({
        retriesCount: actionInputs.asyncRetriesCount,
        successTarget,
        failureTarget,
        serviceAccountId
    })
}
