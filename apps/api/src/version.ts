/** API version reported by /v1/health and the admin "Sistema" page. */
export const API_VERSION = '0.3.0';

export const API_VERSION_INFO = {
  version: API_VERSION,
  /** Set by the Docker build (GIT_SHA build arg); "dev" locally. */
  commit: process.env.GIT_SHA ?? 'dev',
};
