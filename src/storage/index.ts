import {IamTokenService} from '@yandex-cloud/nodejs-sdk/dist/token-service/iam-token-service';
import axios from 'axios';
import {IStorageObject, StorageObject} from './storage-object';
import {IIAmCredentials} from '@yandex-cloud/nodejs-sdk/dist/types';

interface StorageService {
  getObject(bucketName: string, objectName: string): Promise<IStorageObject>;

  putObject(object: object): Promise<void>;
}

export class StorageServiceImpl implements StorageService {
  static __endpointId = 'storage';
  private readonly _address: string = 'storage.yandexcloud.net:443';
  private readonly _tokenCreator: () => Promise<string>;
  private $method_definitions: unknown;

  constructor(sessionConfig: IIAmCredentials) {
    const ts = new IamTokenService(sessionConfig);
    this._tokenCreator = async () => ts.getToken();

    this.$method_definitions = {};
  }

  async getObject(bucketName: string, objectName: string): Promise<StorageObject> {
    const token = await this._tokenCreator();
    const res = await axios.get(this.#_url(bucketName, objectName), {
      headers: {
        'X-YaCloud-SubjectToken': token,
      },
    });
    const buf = await res.data();
    return StorageObject.fromBuffer(bucketName, objectName, buf);
  }

  async putObject({bucketName, bufferPromise, objectName}: IStorageObject): Promise<void> {
    const token = await this._tokenCreator();
    const buffer = await bufferPromise;
    await axios.put(this.#_url(bucketName, objectName), buffer, {
      headers: {
        'X-YaCloud-SubjectToken': token,
      },
    });
  }

  #_url(bucketName: string, objectName: string): string {
    return `https://${this._address}/${bucketName}/${objectName}`;
  }
}
