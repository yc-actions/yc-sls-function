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
      uses: yc-actions/yc-sls-function@v2
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
```

`yc-sa-json-credentials` should contain JSON with authorized key for Service Account. More info
in [Yandex Cloud IAM documentation](https://cloud.yandex.ru/docs/container-registry/operations/authentication#sa-json).

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
