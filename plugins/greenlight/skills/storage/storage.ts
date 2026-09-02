// @greenlight-spec: decisions/0059-app-blob-storage-proxy.md
//
// Copy this file into a Greenlight app that declares `resources: [{ kind: blob }]`.
// No dependencies. Reads GREENLIGHT_PROXY_URL + GREENLIGHT_DATA_KEY.

export class StorageClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;

  constructor(args: { code: string; message: string; status: number; requestId?: string | null }) {
    super(args.message);
    this.name = 'StorageClientError';
    this.code = args.code;
    this.status = args.status;
    this.requestId = args.requestId ?? null;
  }
}

export interface ObjectInfo {
  key: string;
  sizeBytes: number;
  contentType: string | null;
  etag?: string;
  lastModified?: string;
}

export interface ListPage {
  items: ObjectInfo[];
  nextCursor: string | null;
}

export interface StorageCallOpts {
  actorToken?: string;
}

export interface PutObjectOpts extends StorageCallOpts {
  contentLength: number;
  contentType?: string;
}

/** Percent-encodes each `/`-separated segment so apps never hand-build storage URLs. */
export function encodeObjectKey(key: string): string {
  if (key === '') {
    throw new StorageClientError({
      code: 'storage.key_invalid',
      message: 'Object key must not be empty.',
      status: 400,
    });
  }
  return key
    .split('/')
    .map((segment) => {
      if (segment === '' || segment === '.' || segment === '..') {
        throw new StorageClientError({
          code: 'storage.key_invalid',
          message: `Invalid object key segment ${JSON.stringify(segment)}.`,
          status: 400,
        });
      }
      return encodeURIComponent(segment);
    })
    .join('/');
}

function config(): { base: string; key: string } {
  const base = process.env['GREENLIGHT_PROXY_URL']?.replace(/\/$/, '');
  const key = process.env['GREENLIGHT_DATA_KEY'];
  if (!base || !key) {
    throw new StorageClientError({
      code: 'storage.not_provisioned',
      message: 'GREENLIGHT_PROXY_URL and GREENLIGHT_DATA_KEY must be set.',
      status: 403,
    });
  }
  return { base, key };
}

function authHeaders(opts?: {
  actorToken?: string;
  contentType?: string;
  contentLength?: number;
}): Headers {
  const headers = new Headers();
  headers.set('Authorization', `Bearer ${config().key}`);
  if (opts?.actorToken) headers.set('X-Greenlight-Actor-Token', opts.actorToken);
  if (opts?.contentType) headers.set('Content-Type', opts.contentType);
  if (opts?.contentLength !== undefined) headers.set('Content-Length', String(opts.contentLength));
  return headers;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  let code = res.status === 404 ? 'storage.object_not_found' : 'storage.upstream_failed';
  let message = `Storage request failed (${res.status}).`;
  let requestId: string | null = res.headers.get('x-request-id');
  try {
    const rec = asRecord(await res.json());
    if (typeof rec?.['code'] === 'string') code = rec['code'];
    if (typeof rec?.['message'] === 'string') message = rec['message'];
    if (typeof rec?.['request_id'] === 'string') requestId = rec['request_id'];
  } catch {
    // Keep the status-derived defaults when the body is not the docs/16 envelope.
  }
  throw new StorageClientError({ code, message, status: res.status, requestId });
}

function metadataFromJson(value: unknown): ObjectInfo {
  const rec = asRecord(value);
  if (rec === null || typeof rec['key'] !== 'string') {
    throw new StorageClientError({
      code: 'storage.upstream_failed',
      message: 'Malformed object metadata.',
      status: 502,
    });
  }
  return {
    key: rec['key'],
    sizeBytes: typeof rec['size_bytes'] === 'number' ? rec['size_bytes'] : 0,
    contentType: typeof rec['content_type'] === 'string' ? rec['content_type'] : null,
    ...(typeof rec['etag'] === 'string' ? { etag: rec['etag'] } : {}),
    ...(typeof rec['last_modified'] === 'string' ? { lastModified: rec['last_modified'] } : {}),
  };
}

function metadataFromHeaders(key: string, headers: Headers): ObjectInfo {
  const lastModified = headers.get('last-modified');
  const etag = headers.get('etag');
  const parsedLength = Number(headers.get('content-length') ?? 0);
  const parsedModified = lastModified === null ? Number.NaN : Date.parse(lastModified);
  return {
    key,
    sizeBytes: Number.isFinite(parsedLength) ? parsedLength : 0,
    contentType: headers.get('content-type'),
    ...(etag !== null ? { etag } : {}),
    ...(Number.isFinite(parsedModified)
      ? { lastModified: new Date(parsedModified).toISOString() }
      : {}),
  };
}

function isReadableStream(body: BodyInit): boolean {
  return typeof ReadableStream === 'function' && body instanceof ReadableStream;
}

function objectUrl(key: string): string {
  return `${config().base}/storage/objects/${encodeObjectKey(key)}`;
}

export async function putObject(
  key: string,
  body: BodyInit,
  opts: PutObjectOpts,
): Promise<ObjectInfo> {
  const init: RequestInit = {
    method: 'PUT',
    headers: authHeaders(opts),
    body,
  };
  if (isReadableStream(body)) {
    Object.assign(init, { duplex: 'half' });
  }
  const res = await fetch(objectUrl(key), init);
  await throwIfNotOk(res);
  return metadataFromJson(await res.json());
}

export async function getObject(
  key: string,
  opts?: StorageCallOpts,
): Promise<{ stream: ReadableStream<Uint8Array>; metadata: ObjectInfo }> {
  const res = await fetch(objectUrl(key), { method: 'GET', headers: authHeaders(opts) });
  await throwIfNotOk(res);
  if (res.body === null) {
    throw new StorageClientError({
      code: 'storage.upstream_failed',
      message: 'Empty download body.',
      status: 502,
    });
  }
  return { stream: res.body, metadata: metadataFromHeaders(key, res.headers) };
}

export async function headObject(key: string, opts?: StorageCallOpts): Promise<ObjectInfo> {
  const res = await fetch(objectUrl(key), { method: 'HEAD', headers: authHeaders(opts) });
  await throwIfNotOk(res);
  return metadataFromHeaders(key, res.headers);
}

export async function deleteObject(key: string, opts?: StorageCallOpts): Promise<void> {
  const res = await fetch(objectUrl(key), { method: 'DELETE', headers: authHeaders(opts) });
  await throwIfNotOk(res);
}

export async function listObjects(
  opts?: StorageCallOpts & { prefix?: string; cursor?: string; limit?: number },
): Promise<ListPage> {
  const query = new URLSearchParams();
  if (opts?.prefix) query.set('prefix', opts.prefix);
  if (opts?.cursor) query.set('cursor', opts.cursor);
  if (opts?.limit !== undefined) query.set('limit', String(opts.limit));
  const qs = query.toString();
  const res = await fetch(`${config().base}/storage/objects${qs === '' ? '' : `?${qs}`}`, {
    method: 'GET',
    headers: authHeaders(opts),
  });
  await throwIfNotOk(res);
  const rec = asRecord(await res.json());
  const items = rec?.['items'];
  if (!Array.isArray(items)) {
    throw new StorageClientError({
      code: 'storage.upstream_failed',
      message: 'Malformed list page.',
      status: 502,
    });
  }
  return {
    items: items.map(metadataFromJson),
    nextCursor: typeof rec['next_cursor'] === 'string' ? rec['next_cursor'] : null,
  };
}
