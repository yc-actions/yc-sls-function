/**
 * Workload Identity Federation (WIF) authentication utilities.
 *
 * Exchanges GitHub OIDC tokens for Yandex Cloud IAM tokens.
 *
 * @module
 */

import { info } from '@actions/core'
import axios from 'axios'

/**
 * Exchanges GitHub OIDC token for Yandex Cloud IAM token.
 *
 * Uses OAuth 2.0 Token Exchange (RFC 8693) with Yandex Cloud auth endpoint.
 *
 * @param token - GitHub OIDC ID token from GitHub Actions
 * @param saId - Yandex Cloud service account ID
 * @returns Yandex Cloud IAM access token
 * @throws {Error} If token exchange fails or response is invalid
 *
 * @see {@link https://cloud.yandex.com/docs/iam/operations/authentication/workload-identity}
 *
 * @example
 * const ghToken = await getIDToken()
 * const iamToken = await exchangeToken(ghToken, 'aje123abc')
 */
export async function exchangeToken(token: string, saId: string): Promise<string> {
    info(`Exchanging token for service account ${saId}`)
    const res = await axios.post(
        'https://auth.yandex.cloud/oauth/token',
        {
            grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
            requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
            audience: saId,
            subject_token: token,
            subject_token_type: 'urn:ietf:params:oauth:token-type:id_token'
        },
        {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        }
    )
    if (res.status !== 200) {
        throw new Error(`Failed to exchange token: ${res.status} ${res.statusText}`)
    }
    if (!res.data.access_token) {
        throw new Error(`Failed to exchange token: ${res.data.error} ${res.data.error_description}`)
    }
    info(`Token exchanged successfully`)
    return res.data.access_token
}
