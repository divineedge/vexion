import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

const require = createRequire(import.meta.url);
const { createStaticServer } = require('./serve.js');
const { readPublicFile } = require('./public-files.cjs');
let directory: string;
let root: string;
const server = () => createStaticServer({
  staticRoot: root, basePath: '/field',
  template: '<p>APP_NAME_PLACEHOLDER</p><a href="BASE_URL_PLACEHOLDER">EXPS_URL_PLACEHOLDER</a>',
  appName: '<script>unsafe</script>',
});
async function request(url: string, headers: Record<string, string> = {}, method = 'GET') {
  const app = server();
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve));
  try {
    const port = (app.address() as AddressInfo).port;
    const response = await fetch(`http://127.0.0.1:${port}${url}`, { method, headers });
    return { status: response.status, text: await response.text(), headers: response.headers };
  } finally {
    await new Promise<void>((resolve, reject) => app.close((error?: Error) => error ? reject(error) : resolve()));
  }
}

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'field-static-security-'));
  root = path.join(directory, 'build');
  mkdirSync(path.join(root, 'ios'), { recursive: true });
  writeFileSync(path.join(root, 'ios', 'manifest.json'), '{"id":"fixture-manifest"}');
  writeFileSync(path.join(root, 'bundle.js'), '/* safe fixture bundle */');
  writeFileSync(path.join(root, '.private'), 'private');
  writeFileSync(path.join(directory, 'outside.txt'), 'never public');
  symlinkSync(path.join(directory, 'outside.txt'), path.join(root, 'escape.txt'));
  symlinkSync(path.join(root, 'bundle.js'), path.join(root, 'inside.js'));
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('confined Expo static-file server', () => {
  it('serves bundles and a valid platform manifest', async () => {
    const bundle = await request('/field/bundle.js');
    expect(bundle.status).toBe(200);
    expect(bundle.text).toBe('/* safe fixture bundle */');
    expect(bundle.headers.get('x-content-type-options')).toBe('nosniff');
    const manifest = await request('/field/manifest', { 'expo-platform': 'ios' });
    expect(manifest.status).toBe(200);
    expect(JSON.parse(manifest.text).id).toBe('fixture-manifest');
  });
  it('blocks symlinks escaping the build but permits confined targets', async () => {
    expect((await request('/field/escape.txt')).status).toBe(403);
    expect((await request('/field/inside.js')).status).toBe(200);
  });
  it.each([
    '../outside.txt', '%2e%2e/outside.txt', '..%2foutside.txt',
    '%2eprivate', '/.private', '/bundle.js%00', '..\\outside.txt', '/%zz',
  ])('rejects hidden, malformed or traversal paths: %s', input => {
    expect(() => readPublicFile(root, input)).toThrow();
  });
  it('does not accept a platform path supplied as a header', async () => {
    const response = await request('/field/manifest', { 'expo-platform': '../../outside.txt' });
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('never public');
  });
  it('rejects missing files and directories without exposing filesystem paths', async () => {
    expect((await request('/field/missing')).status).toBe(404);
    const response = await request('/field/ios');
    expect(response.status).toBe(404);
    expect(response.text).not.toContain(directory);
  });
  it('escapes the app name and rejects injected forwarded hosts', async () => {
    const page = await request('/field/', { Host: 'fixture.example' });
    expect(page.status).toBe(200);
    expect(page.text).toContain('&lt;script&gt;unsafe&lt;/script&gt;');
    expect(page.text).not.toContain('<script>');
    expect((await request('/field/', { 'X-Forwarded-Host': 'fixture.example"><script>' })).status).toBe(400);
  });
  it('rejects mutation methods', async () => {
    expect((await request('/field/bundle.js', {}, 'POST')).status).toBe(405);
  });
});
