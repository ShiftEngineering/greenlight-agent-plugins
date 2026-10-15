// @greenlight-spec: 48-user-passthrough.md#what-builder-agents-see
// @greenlight-spec: decisions/0086-a-click-before-the-provider.md
//
// An example, in TypeScript, of the server-side helper every app that holds a
// grant on a user passthrough integration needs. Copy it into a TypeScript or
// JavaScript app as is, or port it to the app's own language: it is one HTTP
// call and a classification of the answer, with no dependencies. It reads
// GREENLIGHT_PROXY_URL + GREENLIGHT_DATA_KEY and runs server-side only: the
// data key must never reach a browser.
//
// Every call through the proxy as a person has four outcomes, and the app
// shows each one instead of failing or redirecting:
//   ok             the upstream answered; use `body`
//   not_connected  the person has not connected this integration, or must again:
//                  render a Connect button that opens `connectUrl` — never
//                  navigate there without their click
//   unavailable    the upstream has no account for this person; only IT can
//                  fix it, so show `message` and no button
//   failed         anything else; show that the app can't reach the integration
//                  right now and keep the rest of the page working

export type PassthroughOutcome<T> =
  | { kind: 'ok'; status: number; body: T }
  | { kind: 'not_connected'; integration: string; connectUrl: string; message: string }
  | { kind: 'unavailable'; integration: string; message: string }
  | { kind: 'failed'; integration: string; status: number; code: string | null; message: string };

export interface PassthroughCallOpts {
  /** The inbound `X-Greenlight-Actor-Token` header, forwarded unchanged. */
  actorToken?: string | string[] | undefined;
  /** The absolute URL of the page the person is on, so Connect brings them back to it. */
  returnTo?: string;
  init?: RequestInit;
}

interface GreenlightErrorBody {
  code?: string;
  message?: string;
  details?: { connect_url?: string };
  next_steps?: string;
}

/**
 * One call to a user passthrough integration through the proxy, classified.
 * `path` is the upstream path and query, exactly as you would call the
 * upstream (`/v1.0/me/messages?$top=10`).
 */
export async function passthroughFetch<T = unknown>(
  integration: string,
  path: string,
  opts: PassthroughCallOpts = {},
): Promise<PassthroughOutcome<T>> {
  const base = process.env.GREENLIGHT_PROXY_URL;
  const key = process.env.GREENLIGHT_DATA_KEY;
  if (!base || !key) {
    throw new Error('GREENLIGHT_PROXY_URL and GREENLIGHT_DATA_KEY must be set');
  }
  const headers = new Headers(opts.init?.headers);
  headers.set('Authorization', `Bearer ${key}`);
  const actorToken = Array.isArray(opts.actorToken) ? opts.actorToken[0] : opts.actorToken;
  if (actorToken) headers.set('X-Greenlight-Actor-Token', actorToken);
  const response = await fetch(`${base.replace(/\/+$/, '')}/${integration}${path}`, {
    ...opts.init,
    headers,
  });
  if (response.ok) {
    return { kind: 'ok', status: response.status, body: (await readBody(response)) as T };
  }
  const error = (await readBody(response)) as GreenlightErrorBody | string | null;
  const body = typeof error === 'object' && error !== null ? error : {};
  const code = body.code ?? null;
  if (code === 'proxy.user_connection_required' && body.details?.connect_url) {
    return {
      kind: 'not_connected',
      integration,
      connectUrl: withReturnTo(body.details.connect_url, opts.returnTo),
      message: body.message ?? `Connect ${integration} to use this.`,
    };
  }
  if (code === 'proxy.upstream_user_unmapped') {
    return {
      kind: 'unavailable',
      integration,
      message:
        body.next_steps ??
        body.message ??
        `Your ${integration} account is not set up for this app. Ask IT.`,
    };
  }
  return {
    kind: 'failed',
    integration,
    status: response.status,
    code,
    message: `This app can't reach ${integration} right now.`,
  };
}

/** The Connect page's link, returning to the page the person is on instead of the app's home. */
export function withReturnTo(connectUrl: string, returnTo: string | undefined): string {
  if (!returnTo) return connectUrl;
  const url = new URL(connectUrl);
  url.searchParams.set('return_to', returnTo);
  return url.toString();
}

async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }
  return response.text();
}
