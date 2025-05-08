import { isAsyncInvocation, validateAsyncInvocation } from '../src/async-invovation'
import { ActionInputs } from '../src/types'

describe('Async Invocation module', () => {
    describe('isAsyncInvocation', () => {
        it('should return true if Success Traget and Failure Targaet parameters are defined', () => {
            const inputs = {
                asyncSuccessEmtpyTarget: {},
                asyncFailureYmqTargetQueueArn: 'fakeQueue',
                asyncFailureYmqTargetServiceAccountId: 'fakeID'
            } as ActionInputs
            const result = isAsyncInvocation(inputs)
            expect(result).toEqual(true)
        })

        it('should return false if Success Target parameters are not defined', () => {
            const inputs = {
                asyncFailureYmqTargetQueueArn: 'fakeQueue',
                asyncFailureYmqTargetServiceAccountId: 'fakeID'
            } as ActionInputs
            const result = isAsyncInvocation(inputs)
            expect(result).toEqual(true)
        })

        it('should return false if Failure Target parameters are not defined', () => {
            const inputs = {
                asyncSuccessEmtpyTarget: {}
            } as ActionInputs
            const result = isAsyncInvocation(inputs)
            expect(result).toEqual(true)
        })
    })

    describe('validateAsyncInvocation', () => {
        it('should throw an error if both asyncSuccessEmtpyTarget and asyncSuccessYmqTargetQueueArn are defined', () => {
            const inputs = {
                asyncSuccessEmtpyTarget: {},
                asyncSuccessYmqTargetQueueArn: 'fakeQueue',
                asyncSuccessYmqTargetServiceAccountId: 'fakeID'
            } as ActionInputs
            expect(() => validateAsyncInvocation(inputs)).toThrow(
                'Async invocation configuration is invalid. Only one of "EmtpyTarget" or "YmqTarget" must be defined for the "Success" target.'
            )
        })

        it('should throw an error if both asyncFailureEmtpyTarget and asyncFailureYmqTargetQueueArn are defined', () => {
            const inputs = {
                asyncFailureEmtpyTarget: {},
                asyncFailureYmqTargetQueueArn: 'fakeQueue',
                asyncFailureYmqTargetServiceAccountId: 'fakeID'
            } as ActionInputs
            expect(() => validateAsyncInvocation(inputs)).toThrow(
                'Async invocation configuration is invalid. Only one of "EmtpyTarget" or "YmqTarget" must be defined for the "Failure" target.'
            )
        })

        it('should not throw an error if only asyncSuccessEmtpyTarget is defined', () => {
            const inputs = {
                asyncSuccessEmtpyTarget: {},
                asyncSuccessYmqTargetQueueArn: '',
                asyncSuccessYmqTargetServiceAccountId: '',
                asyncFailureYmqTargetQueueArn: '',
                asyncFailureYmqTargetServiceAccountId: ''
            } as ActionInputs
            expect(() => validateAsyncInvocation(inputs)).not.toThrow()
        })

        it('should not throw an error if only asyncSuccessYmqTargetQueueArn is defined', () => {
            const inputs = {
                asyncSuccessYmqTargetQueueArn: 'fakeQueue',
                asyncSuccessYmqTargetServiceAccountId: 'fakeID',
                asyncFailureYmqTargetQueueArn: '',
                asyncFailureYmqTargetServiceAccountId: ''
            } as ActionInputs
            expect(() => validateAsyncInvocation(inputs)).not.toThrow()
        })

        it('should not throw an error if only asyncFailureEmtpyTarget is defined', () => {
            const inputs = {
                asyncSuccessYmqTargetQueueArn: '',
                asyncSuccessYmqTargetServiceAccountId: '',
                asyncFailureEmtpyTarget: {},
                asyncFailureYmqTargetQueueArn: '',
                asyncFailureYmqTargetServiceAccountId: ''
            } as ActionInputs
            expect(() => validateAsyncInvocation(inputs)).not.toThrow()
        })

        it('should not throw an error if only asyncFailureYmqTargetQueueArn is defined', () => {
            const inputs = {
                asyncSuccessYmqTargetQueueArn: '',
                asyncSuccessYmqTargetServiceAccountId: '',
                asyncFailureYmqTargetQueueArn: 'fakeQueue',
                asyncFailureYmqTargetServiceAccountId: 'fakeID'
            } as ActionInputs
            expect(() => validateAsyncInvocation(inputs)).not.toThrow()
        })
    })
})
