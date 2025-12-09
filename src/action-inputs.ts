/**
 * Complete configuration for Yandex Cloud Serverless Function deployment.
 * Parsed from GitHub Action inputs.
 *
 * @see {@link https://github.com/yc-actions/yc-sls-function#inputs} for input descriptions
 */
export type ActionInputs = {
    /** Yandex Cloud folder ID where function resides */
    folderId: string

    /** Function name (created if doesn't exist) */
    functionName: string

    /** Runtime identifier (e.g., 'nodejs20', 'python312') */
    runtime: string

    /** Entry point in format: `<file-name>.<handler-function>` */
    entrypoint: string

    /** Memory limit in bytes (parsed from '128Mb', '1Gb', etc.) */
    memory: number

    /** Glob patterns for files to include in zip (multiline) */
    include: string[]

    /** Glob patterns to exclude from zip */
    excludePattern: string[]

    /** Root directory for source code (default: '.') */
    sourceRoot: string

    /** Execution timeout in seconds (default: 5) */
    executionTimeout: number

    /** Environment variables in format: `KEY=value` (multiline) */
    environment: string[]

    /** Service account ID for function execution */
    serviceAccount: string

    /** Service account name (resolved to ID if provided) */
    serviceAccountName: string

    /** S3 bucket name for code storage (optional, for >3.5MB) */
    bucket: string

    /** Function version description */
    description: string

    /** Lockbox secrets in format: `ENV_VAR=secret-id/version-id/key` (multiline) */
    secrets: string[]

    /** VPC network ID for function connectivity */
    networkId: string

    /** Version tags (multiline) */
    tags: string[]

    /** Disable cloud logging */
    logsDisabled: boolean

    /** Custom log group ID */
    logsGroupId: string

    /** Minimum log level (TRACE, DEBUG, INFO, WARN, ERROR, FATAL) */
    logLevel: number

    /** Object Storage mount points in format: `<mount>:<bucket>[/<prefix>][:ro]` (multiline) */
    mounts?: string[]

    /** Enable async invocation configuration */
    async: boolean

    /** Service account ID for async invocations */
    asyncSaId: string

    /** Service account name for async invocations */
    asyncSaName: string

    /** Number of retry attempts for failed async invocations (default: 3) */
    asyncRetriesCount: number

    /** YMQ queue ARN for successful async invocation results */
    asyncSuccessYmqArn: string

    /** Service account ID for success queue writes */
    asyncSuccessSaId: string

    /** YMQ queue ARN for failed async invocation results */
    asyncFailureYmqArn: string

    /** Service account ID for failure queue writes */
    asyncFailureSaId: string

    /** Service account name for success queue (resolved to ID) */
    asyncSuccessSaName: string

    /** Service account name for failure queue (resolved to ID) */
    asyncFailureSaName: string
}
