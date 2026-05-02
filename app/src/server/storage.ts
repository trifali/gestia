// MinIO / S3-compatible object storage helper.
// All env config comes from .env.server: MINIO_ENDPOINT, MINIO_PORT,
// MINIO_USE_SSL, MINIO_ACCESS_KEY, MINIO_SECRET_KEY, MINIO_BUCKET.

import { Client as MinioClient } from 'minio';

let _client: MinioClient | null = null;

function getEnv(name: string, required = true): string {
  const v = process.env[name];
  if (!v && required) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v || '';
}

export function getMinioClient(): MinioClient {
  if (_client) return _client;
  _client = new MinioClient({
    endPoint: getEnv('MINIO_ENDPOINT'),
    port: Number(getEnv('MINIO_PORT', false)) || (getEnv('MINIO_USE_SSL', false) === 'true' ? 443 : 80),
    useSSL: getEnv('MINIO_USE_SSL', false) === 'true',
    accessKey: getEnv('MINIO_ACCESS_KEY'),
    secretKey: getEnv('MINIO_SECRET_KEY'),
  });
  return _client;
}

export function getBucket(): string {
  return getEnv('MINIO_BUCKET');
}

async function ensureBucket(): Promise<void> {
  const client = getMinioClient();
  const bucket = getBucket();
  const exists = await client.bucketExists(bucket).catch(() => false);
  if (!exists) {
    await client.makeBucket(bucket, 'us-east-1');
  }
}

export async function putObject(
  key: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  await getMinioClient().putObject(getBucket(), key, buffer, buffer.length, {
    'Content-Type': contentType,
  });
}

export async function removeObject(key: string): Promise<void> {
  try {
    await getMinioClient().removeObject(getBucket(), key);
  } catch {
    // best-effort
  }
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const stream = await getMinioClient().getObject(getBucket(), key);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
