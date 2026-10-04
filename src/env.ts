// The address links in answers are built on (Location headers, Link headers,
// the indexes, the OpenAPI servers). The request's own origin by default;
// behind a proxy, set PUBLIC_URL and the server sets it here at start.

export const config = { publicUrl: '' }

export function publicOrigin(url: URL): string {
  return config.publicUrl || url.origin
}
