import { render } from 'preact';
import { PdvApi } from './api';
import { PdvApp, type PdvEvents } from './app';
import css from './styles.css?inline';

/**
 * <bipae-pdv api="/api/pdv"></bipae-pdv>
 *
 * Attributes:
 *   api          base URL of the backend contract (required)
 *   token        Bearer token (optional; without it the app's session cookie is used)
 *   credentials  same-origin (default) | include (API on another domain, with cookies)
 *   csrf-token   CSRF token sent on every request (Laravel, Rails, Django...)
 *   csrf-header  header name for the CSRF token (default X-CSRF-Token)
 *   theme        light (default) | dark | auto
 *
 * Properties: `token`, `headers` (extra headers) and `fetch` (custom fetch), for apps that
 * prefer not to put credentials in the HTML.
 *
 * Events (bubble out of the element): bipae-pdv:sale, bipae-pdv:sale-cancelled,
 * bipae-pdv:session-opened, bipae-pdv:session-closed, bipae-pdv:error.
 */
export class BipaePdvElement extends HTMLElement {
  static observedAttributes = ['api', 'token', 'credentials', 'csrf-token', 'csrf-header'];

  #root: ShadowRoot;
  #token: string | null = null;
  #headers: Record<string, string> = {};
  #fetch: typeof fetch | undefined;
  #mounted = false;

  constructor() {
    super();
    this.#root = this.attachShadow({ mode: 'open' });
  }

  get token() {
    return this.#token ?? this.getAttribute('token');
  }
  set token(value: string | null) {
    this.#token = value;
    this.#mount();
  }
  get headers() {
    return this.#headers;
  }
  set headers(value: Record<string, string>) {
    this.#headers = { ...value };
    this.#mount();
  }
  set fetch(value: typeof fetch | undefined) {
    this.#fetch = value;
    this.#mount();
  }

  connectedCallback() {
    this.#mounted = true;
    this.#mount();
  }

  disconnectedCallback() {
    this.#mounted = false;
    render(null, this.#root);
  }

  attributeChangedCallback() {
    this.#mount();
  }

  #mount() {
    if (!this.#mounted) return;
    const baseUrl = this.getAttribute('api');
    const headers = { ...this.#headers };
    const csrf = this.getAttribute('csrf-token');
    if (csrf) headers[this.getAttribute('csrf-header') || 'X-CSRF-Token'] = csrf;
    const api = new PdvApi({
      baseUrl: baseUrl ?? '',
      token: this.token,
      credentials: (this.getAttribute('credentials') as RequestCredentials | null) ?? 'same-origin',
      headers,
      ...(this.#fetch && { fetch: this.#fetch }),
    });
    const events: PdvEvents = {
      emit: (name, detail) =>
        this.dispatchEvent(
          new CustomEvent(`bipae-pdv:${name}`, { detail, bubbles: true, composed: true }),
        ),
    };
    // A new key remounts the app with the new connection settings.
    const key = JSON.stringify([baseUrl, this.token, this.getAttribute('credentials'), headers]);
    render(
      <>
        <style>{css}</style>
        <div class="bipae-pdv" part="container">
          {baseUrl ? (
            <PdvApp key={key} api={api} events={events} />
          ) : (
            <p class="center" role="alert">
              Configure o atributo api do &lt;bipae-pdv&gt; (ex.: api="/api/pdv").
            </p>
          )}
        </div>
      </>,
      this.#root,
    );
  }
}

if (!customElements.get('bipae-pdv')) customElements.define('bipae-pdv', BipaePdvElement);

declare global {
  interface HTMLElementTagNameMap {
    'bipae-pdv': BipaePdvElement;
  }
}
