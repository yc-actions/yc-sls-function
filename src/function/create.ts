/**
 * Function lookup and creation.
 *
 * @module
 */

import { endGroup, error, info, setOutput, startGroup } from '@actions/core'
import { context } from '@actions/github'
import { Session, waitForOperation } from '@yandex-cloud/nodejs-sdk'
import { functionService } from '@yandex-cloud/nodejs-sdk/serverless-functions-v1'
import {
    CreateFunctionMetadata,
    CreateFunctionRequest,
    ListFunctionsRequest
} from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/serverless/functions/v1/function_service'
import { ActionInputs } from '../action-inputs.js'

/**
 * Finds existing function by name or creates new one in the folder.
 *
 * Searches for function by exact name match. If not found, creates new function
 * with description linking to GitHub repository.
 *
 * @param session - Authenticated Yandex Cloud SDK session
 * @param inputs - Action inputs containing folderId and functionName
 * @returns Function ID (existing or newly created)
 * @throws {Error} If function creation fails or ID cannot be resolved
 */
export async function getOrCreateFunctionId(
    session: Session,
    { folderId, functionName }: ActionInputs
): Promise<string> {
    startGroup('Find function id')
    const client = session.client(functionService.FunctionServiceClient)

    const res = await client.list(
        ListFunctionsRequest.fromPartial({
            folderId,
            filter: `name = '${functionName}'`
        })
    )
    let functionId: string
    // If there is a function with the provided name in given folder, then return its id
    if (res.functions.length) {
        functionId = res.functions[0].id
        info(`'There is the function named '${functionName}' in the folder already. Its id is '${functionId}'`)
    } else {
        // Otherwise create new a function and return its id.
        const repo = context.repo

        const op = await client.create(
            CreateFunctionRequest.fromPartial({
                folderId,
                name: functionName,
                description: `Created from ${repo.owner}/${repo.repo}`
            })
        )
        const finishedOp = await waitForOperation(op, session)
        if (finishedOp.metadata) {
            const meta = CreateFunctionMetadata.decode(finishedOp.metadata.value)
            functionId = meta.functionId
            info(
                `There was no function named '${functionName}' in the folder. So it was created. Id is '${functionId}'`
            )
        } else {
            error(`Failed to create function '${functionName}'`)
            throw new Error('Failed to create function')
        }
        if (!functionId) throw new Error('Function ID not resolved')
    }
    setOutput('function-id', functionId)
    endGroup()
    return functionId
}
