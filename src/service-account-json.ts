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
  const requiredFields = ['id', 'private_key', 'service_account_id'];
  const missingFields: string[] = [];

  for (const field of requiredFields) {
    if (!data.hasOwnProperty(field)) {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    const missingFieldsString = missingFields.join(', ');
    throw new Error(
      `Service Account key provided in "yc-sa-json-credentials" is missing required fields: ${missingFieldsString}`,
    );
  }

  return {
    accessKeyId: data.id,
    privateKey: data.private_key,
    serviceAccountId: data.service_account_id,
  };
}
