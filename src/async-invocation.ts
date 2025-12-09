/**
 * Async invocation configuration validation and creation.
 *
 * Handles validation of interdependent async configuration inputs:
 * - YMQ queue ARNs require corresponding service accounts
 * - Service account can be specified by ID or name (but not both)
 * - Falls back to main function service account if async SA not provided
 *
 * @module
 */

import { ActionInputs } from './action-inputs'
import { Session } from '@yandex-cloud/nodejs-sdk'
import { resolveServiceAccountId } from './service-account'
import {
    AsyncInvocationConfig,
    AsyncInvocationConfig_ResponseTarget
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function'

/**
 * Checks if async invocation is enabled.
 *
 * @param actionInputs - Action configuration
 * @returns true if async flag is set
 */
export function isAsync(actionInputs: ActionInputs): boolean {
    return actionInputs.async
}

/**
 * Validates async invocation configuration inputs.
 *
 * Enforces validation rules:
 * 1. If `asyncSuccessYmqArn` is set, exactly one of `asyncSuccessSaId` or `asyncSuccessSaName` must be provided
 * 2. If `asyncFailureYmqArn` is set, exactly one of `asyncFailureSaId` or `asyncFailureSaName` must be provided
 *
 * @param actionInputs - Action configuration to validate
 * @returns true if validation passes
 * @throws {Error} If validation rules are violated
 *
 * @example
 * // Valid: asyncSuccessYmqArn with asyncSuccessSaId
 * // Invalid: asyncSuccessYmqArn with both asyncSuccessSaId and asyncSuccessSaName
 */
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

/**
 * Creates async invocation configuration for function version.
 *
 * Resolves service accounts by name if needed and constructs configuration
 * with success/failure targets. Falls back to main function service account
 * if async-specific service account not provided.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param actionInputs - Action configuration
 * @returns Async invocation config or undefined if async disabled
 * @throws {Error} If validation fails or service account resolution fails
 *
 * @remarks
 * Empty targets are used when YMQ ARN is not provided.
 */
export async function createAsyncInvocationConfig(
    session: Session,
    actionInputs: ActionInputs
): Promise<AsyncInvocationConfig | undefined> {
    if (!isAsync(actionInputs)) {
        return undefined
    }
    validateAsync(actionInputs)

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

    // Resolve service account for async invocations
    let serviceAccountId = await resolveServiceAccountId(
        session,
        actionInputs.folderId,
        actionInputs.asyncSaId,
        actionInputs.asyncSaName
    )
    // Fallback to main function service account if async SA not provided
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
