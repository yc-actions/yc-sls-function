import { ActionInputs } from './types'

export function isAsyncInvocation(inputs: ActionInputs): boolean {
    const {
        asyncSuccessEmtpyTarget,
        asyncSuccessYmqTargetQueueArn,
        asyncSuccessYmqTargetServiceAccountId,
        asyncFailureEmtpyTarget,
        asyncFailureYmqTargetQueueArn,
        asyncFailureYmqTargetServiceAccountId
    } = inputs
    const isSuccessTargetSet =
        asyncSuccessEmtpyTarget !== undefined ||
        (asyncSuccessYmqTargetQueueArn !== '' && asyncSuccessYmqTargetServiceAccountId !== '')
    const isFailureTargetSet =
        asyncFailureEmtpyTarget !== undefined ||
        (asyncFailureYmqTargetQueueArn !== '' && asyncFailureYmqTargetServiceAccountId !== '')
    return isSuccessTargetSet && isFailureTargetSet
}

export function validateAsyncInvocation(inputs: ActionInputs): void {
    const {
        asyncSuccessEmtpyTarget,
        asyncSuccessYmqTargetQueueArn,
        asyncSuccessYmqTargetServiceAccountId,
        asyncFailureEmtpyTarget,
        asyncFailureYmqTargetQueueArn,
        asyncFailureYmqTargetServiceAccountId
    } = inputs
    if (
        asyncSuccessEmtpyTarget !== undefined &&
        (asyncSuccessYmqTargetQueueArn !== '' || asyncSuccessYmqTargetServiceAccountId !== '')
    ) {
        throw new Error(
            'Async invocation configuration is invalid. Only one of "EmtpyTarget" or "YmqTarget" must be defined for the "Success" target.'
        )
    }

    if (
        asyncFailureEmtpyTarget !== undefined &&
        (asyncFailureYmqTargetQueueArn !== '' || asyncFailureYmqTargetServiceAccountId !== '')
    ) {
        throw new Error(
            'Async invocation configuration is invalid. Only one of "EmtpyTarget" or "YmqTarget" must be defined for the "Failure" target.'
        )
    }
}
