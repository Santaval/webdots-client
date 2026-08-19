import css from '../styles/index.css?inline';

export interface ShadowHostOptions {
  container: HTMLElement;
  zIndex: number;
  theme: 'light' | 'dark' | 'auto';
}

/**
 * Creates the host `<div>`, attaches an open shadow root, and applies the
 * widget stylesheet inside it. Uses Constructable Stylesheets
 * (`adoptedStyleSheets`) when supported, falling back to an injected
 * `<style>` element for older Safari and for jsdom (which lacks
 * `CSSStyleSheet.prototype.replaceSync` / `adoptedStyleSheets`).
 *
 * The host div sets `all: initial` — with `!important` priority, see below —
 * so the host page's cascade cannot reach inside, plus `position: fixed` and
 * the configured z-index so it always floats above page content.
 * `data-webdots-root` is a stable identifying attribute other code (and
 * tests) can query for.
 */
export class ShadowHost {
  readonly host: HTMLDivElement;
  readonly shadowRoot: ShadowRoot;

  constructor(options: ShadowHostOptions) {
    this.host = document.createElement('div');
    this.host.setAttribute('data-webdots-root', '');
    if (options.theme !== 'auto') {
      this.host.setAttribute('data-theme', options.theme);
    }

    // Inline styles on the host itself — the host element is in the LIGHT
    // DOM, so it is the one part of the widget the host page's cascade can
    // still reach.
    //
    // Every declaration MUST carry `!important`. Plain inline styles LOSE to
    // author `!important` rules (cascade order: author-important >
    // inline-normal), and hostile-but-real host pages ship exactly that:
    // `* { margin: 3px !important }`, `div { background: red !important }`.
    // Without this, the page repaints our full-viewport layer (visible wash
    // over the whole site) and — because font/line-height/color inherit
    // ACROSS the shadow boundary — restyles the widget's own UI too.
    // `all: initial` is listed first so the explicit declarations after it
    // win within this block.
    const hostStyles: ReadonlyArray<readonly [string, string]> = [
      ['all', 'initial'],
      ['display', 'block'],
      ['position', 'fixed'],
      ['top', '0'],
      ['right', '0'],
      ['bottom', '0'],
      ['left', '0'],
      ['width', 'auto'],
      ['height', 'auto'],
      ['margin', '0'],
      ['padding', '0'],
      ['border', 'none'],
      ['outline', 'none'],
      ['background', 'none'],
      ['z-index', String(options.zIndex)],
      // The host div itself has no size/paint; only its shadow children
      // (which use pointer-events: auto individually) are interactive.
      ['pointer-events', 'none'],
    ];
    for (const [property, value] of hostStyles) {
      this.host.style.setProperty(property, value, 'important');
    }

    this.shadowRoot = this.host.attachShadow({ mode: 'open' });
    applyStylesheet(this.shadowRoot, css);

    options.container.appendChild(this.host);
  }

  remove(): void {
    this.host.remove();
  }
}

function supportsConstructableStylesheets(): boolean {
  return (
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype &&
    'adoptedStyleSheets' in Document.prototype
  );
}

function applyStylesheet(root: ShadowRoot, cssText: string): void {
  if (supportsConstructableStylesheets()) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  }

  const style = document.createElement('style');
  style.textContent = cssText;
  root.appendChild(style);
}
