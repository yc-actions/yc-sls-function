// Parse environment variables from input array
export function parseEnvironmentVariables(env: string[]): { [s: string]: string } {
    const environment: { [key: string]: string } = {}
    for (const line of env) {
        const [key, value] = line.split(/=(.*)/s)
        environment[key.trim()] = value.trim()
    }
    return environment
}
