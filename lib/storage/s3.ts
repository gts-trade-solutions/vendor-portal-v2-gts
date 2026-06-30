import "server-only";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// Server-only S3 client for the media bucket. Credentials come from the default
// AWS chain: env (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) in prod, or
// AWS_PROFILE locally. Never import this from a client component.
const REGION = process.env.AWS_REGION || "ap-south-1";
// Reuse madenkorea's media bucket. Honour S3_BUCKET (the vendor .env key), then
// fall back to madenkorea's original S3_MEDIA_BUCKET name, then the default.
export const S3_MEDIA_BUCKET =
  process.env.S3_BUCKET || process.env.S3_MEDIA_BUCKET || "madenkorea-media";
const CACHE_CONTROL = "public, max-age=31536000, immutable";

let _client: S3Client | null = null;
export function s3(): S3Client {
  return (_client ??= new S3Client({ region: REGION }));
}

// A presigned PUT URL the browser can upload directly to (keeps AWS creds
// server-side). Caller already authorized the upload. `key` is the full S3 key
// ("<bucket>/<path>").
export async function presignPutUrl(
  key: string,
  contentType: string,
  expiresIn = 300
): Promise<string> {
  // Do NOT sign CacheControl here: a signed cache-control would force the browser
  // PUT to send a matching header or S3 rejects the signature. ContentType is safe
  // (the client sends content-type). Long cache-control on new objects can be
  // applied via CloudFront or a post-process later.
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: S3_MEDIA_BUCKET,
      Key: key,
      ContentType: contentType || "application/octet-stream",
    }),
    { expiresIn }
  );
}

// Server-side byte upload.
export async function s3PutObject(key: string, body: Buffer | Uint8Array, contentType: string) {
  await s3().send(
    new PutObjectCommand({
      Bucket: S3_MEDIA_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream",
      CacheControl: CACHE_CONTROL,
    })
  );
}

export async function s3Exists(key: string): Promise<boolean> {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export async function s3Delete(key: string) {
  await s3().send(new DeleteObjectCommand({ Bucket: S3_MEDIA_BUCKET, Key: key }));
}

export async function s3List(prefix: string): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const res = await s3().send(
      new ListObjectsV2Command({ Bucket: S3_MEDIA_BUCKET, Prefix: prefix, ContinuationToken: token })
    );
    for (const o of res.Contents ?? []) if (o.Key) out.push(o.Key);
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return out;
}

// Public URL for an S3 key — server-side mirror of the client resolver, used
// when a route needs to persist a full URL.
export function s3PublicUrl(key: string): string {
  const cdn = (process.env.NEXT_PUBLIC_MEDIA_CDN_URL || "").replace(/\/+$/, "");
  return `${cdn}/${key}`;
}
