import { describe, expect, it } from 'vitest';
import { desktopReleaseFromGithub, formatFileSize, NO_DESKTOP_RELEASE } from './downloads';

const asset = (name: string, size = 90_000_000) => ({
  name,
  size,
  browser_download_url: `https://github.com/o/r/releases/download/v0.3.0/${name}`,
});

describe('desktop downloads', () => {
  it('maps the fixed installer names of a stable release', () => {
    const release = desktopReleaseFromGithub({
      tag_name: 'v0.3.0',
      published_at: '2026-10-12T20:00:00Z',
      assets: [
        asset('Bipae-0.3.0-windows-x64-setup.exe'),
        asset('Bipae-0.3.0-windows-x64.msi'),
        asset('bipae_0.3.0_amd64.deb'),
        asset('Bipae-0.3.0-linux-x86_64.AppImage'),
        asset('Bipae-0.3.0-windows-x64-setup.exe.sig'),
      ],
    });
    expect(release.available).toBe(true);
    expect(release.version).toBe('0.3.0');
    expect(release.files.map((f) => f.kind)).toEqual([
      'windows-setup',
      'windows-msi',
      'linux-deb',
      'linux-appimage',
    ]);
    expect(release.files[0]!.url).toContain('/v0.3.0/Bipae-0.3.0-windows-x64-setup.exe');
  });

  it('nothing to download for drafts, pre-releases, missing or unknown files', () => {
    expect(desktopReleaseFromGithub(null)).toEqual(NO_DESKTOP_RELEASE);
    expect(desktopReleaseFromGithub({ message: 'Not Found' })).toEqual(NO_DESKTOP_RELEASE);
    expect(
      desktopReleaseFromGithub({
        tag_name: 'v1.0.0-beta.1',
        prerelease: true,
        assets: [asset('Bipae-1.0.0-windows-x64.msi')],
      }),
    ).toEqual(NO_DESKTOP_RELEASE);
    expect(desktopReleaseFromGithub({ tag_name: 'v1.0.0', draft: true })).toEqual(
      NO_DESKTOP_RELEASE,
    );
    expect(desktopReleaseFromGithub({ tag_name: 'v1.0.0', assets: [asset('notes.txt')] })).toEqual(
      NO_DESKTOP_RELEASE,
    );
  });

  it('formats sizes in pt-BR', () => {
    expect(formatFileSize(88_300_000)).toBe('84,2 MB');
    expect(formatFileSize(300)).toBe('1 KB');
  });
});
