import { Controller, Get, Inject, Injectable } from '@nestjs/common';
import { desktopReleaseFromGithub, NO_DESKTOP_RELEASE, type DesktopRelease } from '@bipae/domain';
import type { Config } from '../../config';
import { Public } from '../../common/auth';
import { CONFIG } from '../../common/di';

const FRESH_MS = 10 * 60_000;
const RETRY_MS = 60_000;

/**
 * Latest stable Bipaê Desktop installers, read from the public GitHub Releases of the repo
 * and cached (the unauthenticated GitHub API allows 60 requests per hour per IP). When GitHub
 * is unreachable the last good answer is kept.
 */
@Injectable()
export class DownloadsService {
  private cached: { value: DesktopRelease; until: number } | null = null;
  private pending: Promise<DesktopRelease> | null = null;

  constructor(@Inject(CONFIG) private readonly config: Config) {}

  async desktop(): Promise<DesktopRelease> {
    if (!this.config.DESKTOP_RELEASES_REPO) return NO_DESKTOP_RELEASE;
    if (this.cached && this.cached.until > Date.now()) return this.cached.value;
    this.pending ??= this.fetchLatest().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async fetchLatest(): Promise<DesktopRelease> {
    const url = `https://api.github.com/repos/${this.config.DESKTOP_RELEASES_REPO}/releases/latest`;
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'bipae-api' },
        signal: AbortSignal.timeout(5000),
      });
      // 404 = no release published yet: a real answer, cached like any other.
      if (!response.ok && response.status !== 404) throw new Error(`GitHub ${response.status}`);
      const value = response.ok
        ? desktopReleaseFromGithub(await response.json())
        : NO_DESKTOP_RELEASE;
      this.cached = { value, until: Date.now() + FRESH_MS };
      return value;
    } catch {
      const value = this.cached?.value ?? NO_DESKTOP_RELEASE;
      this.cached = { value, until: Date.now() + RETRY_MS };
      return value;
    }
  }
}

@Controller('downloads')
export class DownloadsController {
  constructor(@Inject(DownloadsService) private readonly downloads: DownloadsService) {}

  @Public()
  @Get('desktop')
  desktop() {
    return this.downloads.desktop();
  }
}
