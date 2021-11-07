import * as core from '@actions/core';
import * as github from '@actions/github';
import archiver from 'archiver';
import * as streamBuffers from 'stream-buffers';
import minimatch from 'minimatch';

import {StorageObject} from '@nikolay.matrosov/yc-ts-sdk/lib/src/storage/v1beta/storageObject';
import {StorageService} from '@nikolay.matrosov/yc-ts-sdk/lib/src/storage/v1beta';
import {Session} from '@nikolay.matrosov/yc-ts-sdk';
import {completion, getMetadata} from '@nikolay.matrosov/yc-ts-sdk/lib/src/operation';
import {FunctionService} from '@nikolay.matrosov/yc-ts-sdk/lib/api/serverless/functions/v1';
import {fromServiceAccountJsonFile} from '@nikolay.matrosov/yc-ts-sdk/lib/src/TokenService/iamTokenService';
import {
  CreateFunctionMetadata,
  CreateFunctionRequest,
  CreateFunctionVersionMetadata,
  CreateFunctionVersionRequest,
  FunctionServiceService,
  ListFunctionsRequest,
} from '@nikolay.matrosov/yc-ts-sdk/lib/generated/yandex/cloud/serverless/functions/v1/function_service';
import {Client} from 'nice-grpc';
import {Operation} from '@nikolay.matrosov/yc-ts-sdk/lib/generated/yandex/cloud/operation/operation';
import {KB, parseMemory} from './memory';
import {Package} from '@nikolay.matrosov/yc-ts-sdk/lib/generated/yandex/cloud/serverless/functions/v1/function';
import * as fs from 'fs';

type ActionInputs = {
  folderId: string;
  functionName: string;
  runtime: string;
  entrypoint: string;
  memory: number;
  include: string[];
  excludePattern: string[];
  executionTimeout: number;
  environment: string[];
  serviceAccount: string;
  bucket: string;
  description: string;
};

async function uploadToS3(bucket: string, functionId: string, session: Session, fileContents: Buffer): Promise<string> {
  const {GITHUB_SHA} = process.env;

  if (!GITHUB_SHA) {
    core.setFailed('Missing GITHUB_SHA');
    throw new Error('Missing GITHUB_SHA');
  }

  //setting object name
  const bucketObjectName = `${functionId}/${GITHUB_SHA}.zip`;
  core.info(`Upload to bucket: "${bucket}/${bucketObjectName}"`);

  const storageService = StorageService(session);

  const storageObject = StorageObject.fromBuffer(bucket, bucketObjectName, fileContents);
  await storageService.putObject(storageObject);
  return bucketObjectName;
}

async function getOrCreateFunctionId(
  session: Session,
  functionService: Client<typeof FunctionServiceService, {}>,
  {folderId, functionName}: ActionInputs,
): Promise<string> {
  core.startGroup('Find function id');
  const res = await functionService.list(
    ListFunctionsRequest.fromPartial({
      folderId,
      filter: `name = '${functionName}'`,
    }),
  );
  let functionId: string;
  // If there is a function with the provided name in given folder, then return its id
  if (res.functions.length) {
    functionId = res.functions[0].id;
    core.info(`'There is the function named '${functionName}' in the folder already. Its id is '${functionId}'`);
  } else {
    // Otherwise create new a function and return its id.
    const repo = github.context.repo;

    const op = await functionService.create(
      CreateFunctionRequest.fromPartial({
        folderId,
        name: functionName,
        description: `Created from ${repo.owner}/${repo.repo}`,
      }),
    );
    await completion(op, session);
    functionId = (getMetadata(op) as CreateFunctionMetadata).functionId;
    core.info(`There was no function named '${functionName}' in the folder. So it was created. Id is '${functionId}'`);
  }
  core.setOutput('function-id', functionId);
  core.endGroup();
  return functionId;
}

async function run(): Promise<void> {
  core.setCommandEcho(true);

  try {
    const ycSaJsonCredentials = core.getInput('yc-sa-json-credentials', {
      required: true,
    });
    core.setSecret(ycSaJsonCredentials);

    const serviceAccountJson = fromServiceAccountJsonFile(JSON.parse(ycSaJsonCredentials));

    const inputs: ActionInputs = {
      folderId: core.getInput('folder-id', {required: true}),
      functionName: core.getInput('function-name', {required: true}),
      runtime: core.getInput('runtime', {required: true}),
      entrypoint: core.getInput('entrypoint', {required: true}),
      memory: parseMemory(core.getInput('revision-memory', {required: false}) || '128Mb'),
      include: core.getMultilineInput('include', {required: false}),
      excludePattern: core.getMultilineInput('exclude', {required: false}),
      executionTimeout: parseInt(core.getInput('execution-timeout', {required: false}) || '5', 10),
      environment: core.getMultilineInput('environment', {required: false}),
      serviceAccount: core.getInput('service-account', {required: false}),
      bucket: core.getInput('bucket', {required: false}),
      description: core.getInput('description', {required: false}),
    };

    core.info('Function inputs set');

    const fileContents = await zipSources(inputs);

    core.info(`Buffer size: ${Buffer.byteLength(fileContents)}b`);

    // Initialize SDK with your token
    const session = new Session({serviceAccountJson});
    const functionService = FunctionService(session);

    const functionId = await getOrCreateFunctionId(session, functionService, inputs);
    let bucketObjectName = '';
    if (inputs.bucket) {
      bucketObjectName = await uploadToS3(inputs.bucket, functionId, session, fileContents);
    }

    await createFunctionVersion(session, functionService, functionId, fileContents, bucketObjectName, inputs);

    core.setOutput('time', new Date().toTimeString());
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    }
  }
}

function handleOperationError(operation: Operation): void {
  if (operation.error) {
    const details = operation.error?.details;
    if (details) {
      throw Error(`${operation.error.code}: ${operation.error.message} (${details.join(', ')})`);
    }

    throw Error(`${operation.error.code}: ${operation.error.message}`);
  }
}

async function createFunctionVersion(
  session: Session,
  functionService: Client<typeof FunctionServiceService, {}>,
  functionId: string,
  fileContents: Buffer,
  bucketObjectName: string,
  inputs: ActionInputs,
): Promise<void> {
  core.startGroup('Create function version');
  try {
    core.info(`Function '${inputs.functionName}' ${functionId}`);

    //convert variables
    core.info(`Parsed memory: "${inputs.memory}"`);
    core.info(`Parsed timeout: "${inputs.executionTimeout}"`);

    const request = CreateFunctionVersionRequest.fromJSON({
      functionId,
      runtime: inputs.runtime,
      entrypoint: inputs.entrypoint,
      resources: {
        memory: inputs.memory,
      },
      serviceAccountId: inputs.serviceAccount,
      description: inputs.description,
      environment: parseEnvironmentVariables(inputs.environment),
      executionTimeout: {seconds: inputs.executionTimeout},
    });

    //get from bucket if supplied
    if (inputs.bucket) {
      core.info(`From bucket: "${inputs.bucket}"`);

      request.package = Package.fromJSON({
        bucketName: inputs.bucket,
        objectName: bucketObjectName,
      });
    } else {
      request.content = fileContents;
    }
    // Create new version
    const operation = await functionService.createVersion(request);
    await completion(operation, session);

    handleOperationError(operation);
    core.info('Operation complete');

    const metadata = getMetadata(operation) as CreateFunctionVersionMetadata;
    core.setOutput('version-id', metadata.functionVersionId);
  } finally {
    core.endGroup();
  }
}

async function zipSources(inputs: ActionInputs): Promise<Buffer> {
  core.startGroup('ZipDirectory');

  try {
    const outputStreamBuffer = new streamBuffers.WritableStreamBuffer({
      initialSize: 1000 * KB, // start at 1000 kilobytes.
      incrementAmount: 1000 * KB, // grow by 1000 kilobytes each time buffer overflows.
    });

    const archive = archiver('zip', {zlib: {level: 9}});
    core.info('Archive initialize');

    archive.pipe(outputStreamBuffer);
    const patterns = parseIgnoreGlobPatterns(inputs.excludePattern);
    for (const line of inputs.include) {
      if (fs.lstatSync(line).isDirectory()) {
        archive.directory(line, line, data => {
          const res = !patterns.map(p => minimatch(data.name, p)).some(x => x);
          return res ? data : false;
        });
      } else {
        archive.file(line, {name: line});
      }
      core.info(`Path '${line}' added to archive`);
    }

    await archive.finalize();

    core.info('Archive finalized');

    outputStreamBuffer.end();
    const buffer = outputStreamBuffer.getContents();
    core.info('Buffer object created');

    if (!buffer) {
      throw Error('Failed to initialize Buffer');
    }

    return buffer;
  } finally {
    core.endGroup();
  }
}

function parseIgnoreGlobPatterns(patterns: string[]): string[] {
  const result: string[] = [];

  for (const pattern of patterns) {
    //only not empty patterns
    if (pattern?.length > 0) {
      result.push(pattern);
    }
  }

  core.info(`Source ignore pattern: "${JSON.stringify(result)}"`);
  return result;
}

function parseEnvironmentVariables(env: string[]): {[s: string]: string} {
  core.info(`Environment string: "${env}"`);

  const environment: {[key: string]: string} = {};
  for (const line of env) {
    const [key, ...value] = line.split('=');
    environment[key.trim()] = value.join()?.trim();
  }

  core.info(`EnvObject: "${JSON.stringify(environment)}"`);
  return environment;
}

run();
