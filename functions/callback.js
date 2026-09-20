import { handleCallback } from './_lib/oauth.js';

export async function onRequest(context) {
  return handleCallback(context.request, context.env);
}
