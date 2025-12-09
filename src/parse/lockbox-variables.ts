// Parse Lockbox secrets from input array

export type Secret = {
    environmentVariable: string
    id: string
    versionId: string
    key: string
}
export function parseLockboxVariables(secrets: string[]): Secret[] {
    const secretsArr: Secret[] = []
    for (const line of secrets) {
        const [environmentVariable, values] = line.split('=')
        const [id, versionId, key] = values.split('/')
        if (!environmentVariable || !id || !key || !versionId) {
            throw new Error(`Broken reference to Lockbox Secret: ${line}`)
        }
        const secret = { environmentVariable, id, versionId, key }
        secretsArr.push(secret)
    }
    return secretsArr
}
