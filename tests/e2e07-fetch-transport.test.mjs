import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createLocalInsecureHttpsFetch } from '../src/lib/e2e07-local-https.mjs';
import { createE2e07Api } from '../src/lib/e2e07-pick-runner.mjs';

function fakeHttpsRequest(captured, status = 200) {
  return (url, options, callback) => {
    const req = new EventEmitter();
    const written = [];
    req.write = chunk => written.push(chunk);
    req.destroy = error => queueMicrotask(() => req.emit('error', error));
    req.end = () => queueMicrotask(() => {
      captured.push({ url: String(url), options, body: written.join('') });
      const response = new EventEmitter();
      response.statusCode = status;
      callback(response);
      response.emit('data', Buffer.from(JSON.stringify({ items: [], totalCount: 0 })));
      response.emit('end');
    });
    return req;
  };
}

test('local -k transport bypasses certificate verification for loopback only and passes API-key header', async () => {
  const captured = [];
  const transport = createLocalInsecureHttpsFetch('https://localhost:7002', fakeHttpsRequest(captured));
  const api = createE2e07Api('https://localhost:7002', { 'X-KineX-Api-Key': 'private-key' }, transport);
  const probe = await api.probe();
  assert.equal(probe.totalCount, 0);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, 'https://localhost:7002/v1/orchard/blocks?page=1&pageSize=1');
  assert.equal(captured[0].options.rejectUnauthorized, false);
  assert.equal(captured[0].options.headers['X-KineX-Api-Key'], 'private-key');
  assert.equal(captured[0].options.method, 'GET');
  assert.ok(captured[0].options.signal);
  assert.equal(captured[0].body, '');
});

test('local -k transport refuses remote, HTTP, unsafe redirection and cross-origin requests', async () => {
  const forbidden = ['https://kinex.test:7001', 'https://example.com', 'http://localhost:5288', 'https://127.0.0.2:7002'];
  for (const url of forbidden) {
    assert.throws(() => createLocalInsecureHttpsFetch(url), /permitted only/i, url);
  }
  const transport = createLocalInsecureHttpsFetch('https://127.0.0.1:7002', () => { throw Error('should not connect'); });
  await assert.rejects(transport('https://localhost:7002/v1/orchard/blocks', { method: 'GET', redirect: 'error' }), /another origin/);
  await assert.rejects(transport('https://127.0.0.1:7002/v1/orchard/blocks', { method: 'GET', redirect: 'follow' }), /no redirects/);
  await assert.rejects(transport('https://127.0.0.1:7002/v1/orchard/blocks', { method: 'DELETE', redirect: 'error' }), /GET\/POST/);
});

test('local -k POST transmits JSON and never follows an API redirect', async () => {
  const captured = [];
  const transport = createLocalInsecureHttpsFetch('https://localhost:7002', fakeHttpsRequest(captured, 302));
  const api = createE2e07Api('https://localhost:7002', { Authorization: 'Bearer fake-secret' }, transport);
  await assert.rejects(api.apply('select', { operationId: 'test-id' }), /HTTP 302/);
  assert.equal(captured.length, 1);
  assert.equal(captured[0].options.method, 'POST');
  assert.equal(captured[0].options.headers.Authorization, 'Bearer fake-secret');
  assert.equal(JSON.parse(captured[0].body).operationId, 'test-id');
});

test('failed native fetch explains selected endpoint, TLS cause and never logs key', async () => {
  const nativeError = new TypeError('fetch failed', {
    cause: Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
  });
  const api = createE2e07Api('https://localhost:7002', { 'X-KineX-Api-Key': 'private-secret-key' }, async () => { throw nativeError; });
  await assert.rejects(api.probe(), error => {
    assert.match(error.message, /https:\/\/localhost:7002\/v1\/orchard\/blocks/);
    assert.match(error.message, /DEPTH_ZERO_SELF_SIGNED_CERT/);
    assert.match(error.message, /-k/);
    assert.doesNotMatch(error.message, /private-secret-key/);
    return true;
  });
});

test('CLI rejects -k on a remote test target before connecting', () => {
  const cli = path.resolve('scripts/e2e-07.mjs');
  const result = spawnSync(process.execPath, [cli,
    '--config', path.resolve('scenarios/e2e07-picks.example.json'),
    '--guide-config', path.resolve('config.example.json'),
    '--target', 'kinex-test-api', '--stage', 'probe', '-k'
  ], { encoding: 'utf8', env: { ...process.env, KINEX_E2E07_API_KEY: 'fake', KINEX_E2E07_BEARER_TOKEN: '' } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /permitted only for an HTTPS localhost or 127\.0\.0\.1/);
  assert.doesNotMatch(result.stderr, /fake/);
});
