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

type GranotCrmS3Sender = {
  send(command: PutObjectCommand): Promise<PutObjectCommandOutput>;
  send(command: GetObjectCommand): Promise<GetObjectCommandOutput>;
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
  const response = await getGranotCrmS3Sender().send(
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
  const response = await getGranotCrmS3Sender().send(
    new GetObjectCommand({
      Bucket: getGranotCrmCsvBucket(),
      Key: key,
    }),
  );
  return response.Body?.transformToString() ?? "";
}

function getGranotCrmS3Sender(): GranotCrmS3Sender {
  return getGranotCrmS3Client() as unknown as GranotCrmS3Sender;
}
