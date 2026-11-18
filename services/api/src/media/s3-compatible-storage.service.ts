import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, createHash } from 'node:crypto';

const MAX_OBJECT_BYTES = 25 * 1024 * 1024;

@Injectable()
export class S3CompatibleStorageService {
  constructor(private readonly config: ConfigService) {}

  async presignPut(key: string, contentType: string, expiresSeconds: number): Promise<string> {
    return this.presign('PUT', key, expiresSeconds, contentType);
  }

  async headObject(key: string): Promise<{ size: number; contentType: string | null }> {
    const url = await this.presign('HEAD', key, 60);
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) {
      throw new ServiceUnavailableException('Uploaded object was not found in private storage.');
    }
    if (!response.ok) {
      throw new ServiceUnavailableException('Could not verify the uploaded object in private storage.');
    }
    const size = Number(response.headers.get('content-length'));
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_OBJECT_BYTES) {
      throw new ServiceUnavailableException('Storage returned an invalid object size.');
    }
    return { size, contentType: response.headers.get('content-type') };
  }

  async getObjectBytes(key: string, expectedSize: number): Promise<Buffer> {
    if (!Number.isSafeInteger(expectedSize) || expectedSize < 1 || expectedSize > MAX_OBJECT_BYTES) {
      throw new ServiceUnavailableException('Object size is outside the permitted processing limit.');
    }
    const url = await this.presign('GET', key, 60);
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      throw new ServiceUnavailableException('Could not read the uploaded object from private storage.');
    }
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isSafeInteger(declaredLength) && declaredLength !== expectedSize) {
      throw new ServiceUnavailableException('Storage returned an unexpected object length.');
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== expectedSize || bytes.length > MAX_OBJECT_BYTES) {
      throw new ServiceUnavailableException('Downloaded object length does not match the verified upload size.');
    }
    return bytes;
  }

  private async presign(
    method: 'PUT' | 'HEAD' | 'GET',
    key: string,
    expiresSeconds: number,
    contentType?: string,
  ): Promise<string> {
    const endpointValue = this.config.get<string>('S3_ENDPOINT');
    const bucket = this.config.get<string>('S3_BUCKET');
    const accessKey = this.config.get<string>('S3_ACCESS_KEY_ID');
    const secretKey = this.config.get<string>('S3_SECRET_ACCESS_KEY');
    const region = this.config.get<string>('S3_REGION', 'auto');
    if (!endpointValue || !bucket || !accessKey || !secretKey) {
      throw new ServiceUnavailableException('Private object storage is not configured.');
    }

    const endpoint = new URL(endpointValue);
    if (endpoint.protocol !== 'https:') {
      throw new ServiceUnavailableException('Object storage endpoint must use HTTPS.');
    }
    const objectPath = [endpoint.pathname.replace(/\/$/, ''), bucket, ...key.split('/')]
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join('/');
    const canonicalUri = `/${objectPath}`;
    const host = endpoint.host;
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\\.\\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/${region}/s3/aws4_request`;
    const params = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKey}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresSeconds),
      'X-Amz-SignedHeaders': contentType ? 'content-type;host' : 'host',
    });
    const canonicalQuery = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const canonicalHeaders = contentType
      ? `content-type:${contentType.trim()}\\nhost:${host}\\n`
      : `host:${host}\\n`;
    const signedHeaders = contentType ? 'content-type;host' : 'host';
    const canonicalRequest = [
      method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders,
      'UNSIGNED-PAYLOAD',
    ].join('\\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256', amzDate, scope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\\n');
    const dateKey = hmac(`AWS4${secretKey}`, dateStamp);
    const regionKey = hmac(dateKey, region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
    params.set('X-Amz-Signature', signature);
    const url = new URL(endpoint.toString());
    url.pathname = canonicalUri;
    url.search = params.toString();
    return url.toString();
  }
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}
