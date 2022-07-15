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
      uses: yc-actions/yc-sls-function@v2.0.0
      with:
        yc-sa-json-credentials: ${{ secrets.YC_SA_JSON_CREDENTIALS }}
        bucket: ${{ secrets.BUCKET }}
        folder-id: 'b1g*********'
        function-name: 'test-function'
        runtime: 'nodejs16'
        revision-memory: '256Mb'
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
`yc-sa-json-credentials` should contain JSON with authorized key for Service Account. More info in [Yandex Cloud IAM documentation](https://cloud.yandex.ru/docs/container-registry/operations/authentication#sa-json).

See [action.yml](action.yml) for the full documentation for this action's inputs and outputs.

## Permissions

To perform this action, it is required that the service account on behalf of which we are acting has granted the `serverless.functions.admin` role or greater.

## License Summary

This code is made available under the MIT license.
