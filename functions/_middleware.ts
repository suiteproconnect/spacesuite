import type { PagesContext } from './_shared/cf.ts';

export async function onRequest(context: PagesContext): Promise<Response> {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) {
    return response;
  }

  const url = new URL(context.request.url);
  const html = await response.text();
  const updated = html.replaceAll('https://spacesuite.pages.dev', url.origin);
  const headers = new Headers(response.headers);
  headers.delete('content-length');

  return new Response(updated, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
