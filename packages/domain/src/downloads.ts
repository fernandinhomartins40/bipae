/**
 * Bipaê Desktop downloads. Installers are published as GitHub Releases with fixed names by
 * `.github/workflows/release-desktop.yml`; the API exposes the latest stable one.
 */

export type DesktopFileKind =
  'windows-setup' | 'windows-msi' | 'macos-dmg' | 'linux-deb' | 'linux-appimage';

export interface DesktopFile {
  kind: DesktopFileKind;
  label: string;
  fileName: string;
  url: string;
  sizeBytes: number;
}

export interface DesktopRelease {
  available: boolean;
  version: string | null;
  publishedAt: string | null;
  files: DesktopFile[];
}

export const NO_DESKTOP_RELEASE: DesktopRelease = {
  available: false,
  version: null,
  publishedAt: null,
  files: [],
};

/** Suffix of each installer name (see the release workflow) and how it is shown. */
const FILE_KINDS: { kind: DesktopFileKind; suffix: string; label: string }[] = [
  {
    kind: 'windows-setup',
    suffix: '-windows-x64-setup.exe',
    label: 'Windows 10 ou 11 (recomendado)',
  },
  {
    kind: 'windows-msi',
    suffix: '-windows-x64.msi',
    label: 'Windows, pacote MSI (para TI e várias máquinas)',
  },
  {
    kind: 'macos-dmg',
    suffix: '-macos-universal.dmg',
    label: 'macOS 11 ou mais novo (Intel e Apple Silicon)',
  },
  { kind: 'linux-deb', suffix: '_amd64.deb', label: 'Linux Ubuntu/Debian (.deb)' },
  {
    kind: 'linux-appimage',
    suffix: '-linux-x86_64.AppImage',
    label: 'Linux, qualquer distribuição (AppImage)',
  },
];

interface GithubRelease {
  tag_name?: string;
  published_at?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
}

/** Turns the GitHub "latest release" payload into the downloads shown to clients. */
export function desktopReleaseFromGithub(payload: unknown): DesktopRelease {
  const release = (payload ?? {}) as GithubRelease;
  if (!release.tag_name || release.draft || release.prerelease) return NO_DESKTOP_RELEASE;
  const files: DesktopFile[] = [];
  for (const { kind, suffix, label } of FILE_KINDS) {
    const asset = release.assets?.find((a) => a.name?.endsWith(suffix) && a.browser_download_url);
    if (!asset) continue;
    files.push({
      kind,
      label,
      fileName: asset.name!,
      url: asset.browser_download_url!,
      sizeBytes: asset.size ?? 0,
    });
  }
  if (files.length === 0) return NO_DESKTOP_RELEASE;
  return {
    available: true,
    version: release.tag_name.replace(/^v/, ''),
    publishedAt: release.published_at ?? null,
    files,
  };
}

/** "84,2 MB" */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}
