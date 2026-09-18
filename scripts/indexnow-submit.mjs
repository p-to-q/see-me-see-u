/**
 * Submit the canonical public URL set to IndexNow after a production deploy.
 *
 * The key is deliberately public: the protocol proves control by fetching the
 * same value from `/<key>.txt`. It is not a credential and does not belong in
 * an environment variable. Use `--dry-run` to inspect the exact payload.
 */
import { INDEXNOW_KEY, PUBLIC_PAGES, SITE, canonical } from '../packages/app/src/site/discovery.ts';

const endpoint = 'https://api.indexnow.org/indexnow';
const urls = PUBLIC_PAGES.map((page) => canonical(page.path));
const body = {
  host: new URL(SITE.origin).host,
  key: INDEXNOW_KEY,
  keyLocation: canonical(`/${INDEXNOW_KEY}.txt`),
  urlList: urls,
};

if (process.argv.includes('--dry-run')) {
  process.stdout.write(`${JSON.stringify(body, null, 2)}\n`);
  process.exit(0);
}

const signal = AbortSignal.timeout(15_000);
const response = await fetch(endpoint, {
  method: 'POST',
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
  signal,
});

if (![200, 202].includes(response.status)) {
  const detail = (await response.text()).slice(0, 1_000);
  throw new Error(`IndexNow rejected ${urls.length} URLs: ${response.status} ${detail}`);
}

process.stdout.write(`IndexNow accepted ${urls.length} canonical URLs (${response.status}).\n`);
