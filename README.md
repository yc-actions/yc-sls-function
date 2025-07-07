## GitHub Action to deploy Serverless Function to Yandex Cloud

The action finds or creates Serverless Function in the given folder in Yandex Cloud and deploys new version.

**Table of Contents**

<!-- toc -->

- [Usage](#usage)
- [Permissions](#permissions)
- [License Summary](#license-summary)

<!-- tocstop -->

## Usage

```yaml
    - name: Deploy Function
      id: sls-func
      uses: yc-actions/yc-sls-function@v3
      with:
        yc-sa-json-credentials: ${{ secrets.YC_SA_JSON_CREDENTIALS }}
        bucket: ${{ secrets.BUCKET }}
        folder-id: 'b1g*********'
        function-name: 'test-function'
        runtime: 'nodejs16'
        memory: '256Mb'
        entrypoint: 'src/main.handler'
        environment: |
          DEBUG=True
          COUNT=1
        include: |
          ./src
          package.json
        exclude: |
          **/*.ts
        tags: |
          ${{ GITHUB_SHA::6 }}
          foo
        secrets: |
          DB_PASSWORD=lockbox-secret-id/latest/password
          API_KEY=lockbox-secret-id/abcdef123456/api_key
```

### Lockbox Secrets: Using the Latest Version

You can specify Lockbox secrets for your function using the `secrets` input. The format is:

```
<ENV_VAR>=<lockbox-secret-id>/<version-id>/<key>
```

**New Feature:**
- You can now use `latest` as the `<version-id>` to automatically use the most recent version of the secret at deploy time.
- Example:
  ```
  secrets: |
    DB_PASSWORD=lockbox-secret-id/latest/password
    API_KEY=lockbox-secret-id/abcdef123456/api_key
  ```
  In this example, `DB_PASSWORD` will always use the latest version of the secret, while `API_KEY` uses a specific version.

> **Note:** If `latest` is specified and no versions are found for the secret, the deployment will fail with an error.

### Authorization
One of `yc-sa-json-credentials`, `yc-iam-token` or `yc-sa-id` should be provided depending on the authentication method
you
want to use. The action will use the first one it finds.

* `yc-sa-json-credentials` should contain JSON with authorized key for Service Account. More info
  in [Yandex Cloud IAM documentation](https://yandex.cloud/en/docs/iam/operations/authentication/manage-authorized-keys#cli_1).
* `yc-iam-token` should contain IAM token. It can be obtained using `yc iam create-token` command or using
  [yc-actions/yc-iam-token-fed](https://github.com/yc-actions/yc-iam-token-fed)

```yaml
  - name: Get Yandex Cloud IAM token
    id: get-iam-token
    uses: docker://ghcr.io/yc-actions/yc-iam-token-fed:1.0.0
    with:
      yc-sa-id: aje***
```

* `yc-sa-id` should contain Service Account ID. It can be obtained using `yc iam service-accounts list` command. It is
  used to exchange GitHub token for IAM token using Workload Identity Federation. More info
  in [Yandex Cloud IAM documentation](https://yandex.cloud/ru/docs/iam/concepts/workload-identity).

### Async invocation

To make the function be able to be invoked asynchronously, you need to set the `async` input parameter to `true`.

```yaml
    - name: Deploy Function
      id: sls-func
      uses: yc-actions/yc-sls-function@v3
      with:
        yc-sa-json-credentials: ${{ secrets.YC_SA_JSON_CREDENTIALS }}
        bucket: ${{ secrets.BUCKET }}
        folder-id: 'b1g*********'
        function-name: 'test-function'
        runtime: 'nodejs16'
        memory: '256Mb'
        entrypoint: 'src/main.handler'
        environment: |
          DEBUG=True
          COUNT=1
        include: |
          ./src
          package.json
        exclude: |
          **/*.ts
        tags: |
          ${{ GITHUB_SHA::6 }}
          foo
        async: true
```

Also, you can provide additional parameters for async invocation:

| **Input Name**          | **Description**                                                                                                   | **Default** |
|-------------------------|-------------------------------------------------------------------------------------------------------------------|-------------|
| `async`                 | Enable async invocation.                                                                                          | `'false'`   |
| `async-sa-id`           | Service account with permission to invoke the function. Defaults to the default service account if not set.       | `''`        |
| `async-sa-name`         | Service account name with permission to invoke the function. Use either this or `async-sa-id`.                    | `''`        |
| `async-retries-count`   | Number of retries for async invocations.                                                                          | `'3'`       |
| `async-success-ymq-arn` | Target for successful invocation results. Queue ARN for sending results to YMQ.                                   | `''`        |
| `async-success-sa-id`   | Service account ID with write permission on the queue for successful invocation results.                          | `''`        |
| `async-success-sa-name` | Service account name with write permission on the queue for successful invocation results. Use either this or ID. | `''`        |
| `async-failure-ymq-arn` | Target for failed invocation results after all retries. Queue ARN for sending results to YMQ.                     | `''`        |
| `async-failure-sa-id`   | Service account ID with write permission on the queue for failed invocation results.                              | `''`        |
| `async-failure-sa-name` | Service account name with write permission on the queue for failed invocation results. Use either this or ID.     | `''`        |

See [action.yml](action.yml) for the full documentation for this action's inputs and outputs.

## Permissions

### Deploy time permissions

To perform this action, the service account on behalf of which we are acting must have
the `functions.editor` role or higher.

Additionally, you may need to grant the following optional roles depending on your specific needs:

| Optional Role              | Required For                                                                           |
|----------------------------|----------------------------------------------------------------------------------------|
| `iam.serviceAccounts.user` | Providing the service account ID in parameters, ensuring access to the service account |
| `vpc.user`                 | Deploying the function in a VPC with a specified network ID                            |
| `functions.admin`          | Making the function public                                                             |

### Runtime permissions

The service account provided to function via `service-account` parameter must have the following roles:

| Required Role                 | Required For                                                        |
|-------------------------------|---------------------------------------------------------------------|
| `lockbox.payloadViewer`       | To access the Lockbox secrets.                                      |
| `kms.keys.encrypterDecrypter` | To decrypt the Lockbox secrets, if they are encrypted with KMS key. |

## License Summary

This code is made available under the MIT license.
