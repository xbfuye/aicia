import { handleAuth } from './_lib/oauth.js';

export async function onRequest(context) {
  return handleAuth(context.request, context.env);
}
