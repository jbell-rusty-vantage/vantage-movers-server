import {
  GetObjectCommand,
  type GetObjectCommandOutput,
  PutObjectCommand,
  type PutObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { fromIni } from "@aws-sdk/credential-providers";
import {
  getGranotCrmAwsProfile,
  getGranotCrmCsvBucket,
  getGranotCrmCsvRegion,
} from "../../config/domain";

let cachedClient: S3Client | undefined;

type S3RuntimeSender<Command, Output> = {
  send(command: Command): Promise<Output>;
};

export function getGranotCrmS3Client(): S3Client {
  if (cachedClient) {
    return cachedClient;
  }

  const profile = getGranotCrmAwsProfile();
  cachedClient = new S3Client({
    region: getGranotCrmCsvRegion(),
    ...(profile ? { credentials: fromIni({ profile }) } : {}),
  });
  return cachedClient;
}

export async function putGranotCrmObject(input: {
  key: string;
  body: string | Uint8Array;
  contentType: string;
  metadata?: Record<string, string>;
}): Promise<{ bucket: string; key: string; versionId?: string }> {
  const bucket = getGranotCrmCsvBucket();
  const response = await sendS3Command<PutObjectCommand, PutObjectCommandOutput>(
    getGranotCrmS3Client(),
    new PutObjectCommand({
      Bucket: bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ServerSideEncryption: "AES256",
      Metadata: input.metadata,
    }),
  );
  return {
    bucket,
    key: input.key,
    versionId: response.VersionId,
  };
}

export async function getGranotCrmObjectText(key: string): Promise<string> {
  const response = await sendS3Command<GetObjectCommand, GetObjectCommandOutput>(
    getGranotCrmS3Client(),
    new GetObjectCommand({
      Bucket: getGranotCrmCsvBucket(),
      Key: key,
    }),
  );
  return response.Body?.transformToString() ?? "";
}

function sendS3Command<Command, Output>(
  client: S3Client,
  command: Command,
): Promise<Output> {
  // Vercel's per-function checker can lose S3Client.send inherited from Smithy.
  // The intersection preserves the real client while restoring that runtime method.
  return (client as S3Client & S3RuntimeSender<Command, Output>).send(command);
}
