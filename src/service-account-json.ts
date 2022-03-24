import {IIAmCredentials} from '@yandex-cloud/nodejs-sdk/dist/types';

export interface ServiceAccountJsonFileContents {
  id: string;
  created_at: string;
  key_algorithm: string;
  service_account_id: string;
  private_key: string;
  public_key: string;
}

export function fromServiceAccountJsonFile(data: ServiceAccountJsonFileContents): IIAmCredentials {
  return {
    accessKeyId: data.id,
    privateKey: data.private_key,
    serviceAccountId: data.service_account_id,
  };
}
