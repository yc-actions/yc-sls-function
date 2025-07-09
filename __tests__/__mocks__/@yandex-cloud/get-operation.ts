import { Operation } from '@yandex-cloud/nodejs-sdk/dist/generated/yandex/cloud/operation/operation'
import { Writer } from 'protobufjs'

type PayloadClass<T> = {
    encode: (message: T, writer?: Writer) => Writer
    decode: (payload: Uint8Array) => T
    fromJSON: (payload: object) => T
}

export function getOperation<P, M>(
    payloadClass: PayloadClass<P>,
    data: object,
    metadataClass?: PayloadClass<M>,
    metadata?: object
): Operation {
    return Operation.fromJSON({
        id: 'operationid',
        response: {
            value: Buffer.from(payloadClass.encode(payloadClass.fromJSON(data)).finish()).toString('base64')
        },
        metadata: metadataClass
            ? {
                  value: Buffer.from(metadataClass?.encode(metadataClass?.fromJSON(metadata ?? {})).finish()).toString(
                      'base64'
                  )
              }
            : undefined,
        done: true
    })
}
