export type ActionInputs = {
    folderId: string
    functionName: string
    runtime: string
    entrypoint: string
    memory: number
    include: string[]
    excludePattern: string[]
    sourceRoot: string
    executionTimeout: number
    environment: string[]
    serviceAccount: string
    serviceAccountName: string
    bucket: string
    description: string
    secrets: string[]
    networkId: string
    tags: string[]
    logsDisabled: boolean
    logsGroupId: string
    logLevel: number

    async: boolean
    asyncSaId: string
    asyncSaName: string
    asyncRetriesCount: number
    asyncSuccessYmqArn: string
    asyncSuccessSaId: string
    asyncFailureYmqArn: string
    asyncFailureSaId: string
    asyncSuccessSaName: string
    asyncFailureSaName: string
}
