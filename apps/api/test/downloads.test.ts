import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestApp } from './helpers';

const RELEASE = {
  tag_name: 'v0.3.0',
  published_at: '2026-10-12T20:00:00Z',
  assets: [
    {
      name: 'Bipae-0.3.0-windows-x64-setup.exe',
      size: 90_000_000,
      browser_download_url:
        'https://github.com/o/r/releases/download/v0.3.0/Bipae-0.3.0-windows-x64-setup.exe',
    },
  ],
};

describe('desktop downloads', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ DESKTOP_RELEASES_REPO: 'o/r' });
  });
  afterAll(() => t.close());
  afterEach(() => vi.unstubAllGlobals());

  it('is public, reads the latest release once and keeps it cached', async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify(RELEASE), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await t.app.inject({ method: 'GET', url: '/v1/downloads/desktop' });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      available: true,
      version: '0.3.0',
      files: [{ kind: 'windows-setup' }],
    });
    await t.app.inject({ method: 'GET', url: '/v1/downloads/desktop' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.github.com/repos/o/r/releases/latest');
  });
});

describe('desktop downloads without a release', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp({ DESKTOP_RELEASES_REPO: 'o/r' });
  });
  afterAll(() => t.close());
  afterEach(() => vi.unstubAllGlobals());

  it('says honestly that nothing is available when GitHub has no release or fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 404 })),
    );
    const response = await t.app.inject({ method: 'GET', url: '/v1/downloads/desktop' });
    expect(response.json()).toEqual({
      available: false,
      version: null,
      publishedAt: null,
      files: [],
    });
  });

  it('disabled when no repository is configured', async () => {
    const off = await createTestApp({ DESKTOP_RELEASES_REPO: '' });
    const response = await off.app.inject({ method: 'GET', url: '/v1/downloads/desktop' });
    expect(response.json()).toMatchObject({ available: false });
    await off.close();
  });
});
