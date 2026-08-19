import type { AnchorStrategy } from './types';

export interface GeneratedSelector {
  strategy: AnchorStrategy;
  /** The winning selector for the chosen strategy. */
  selector: string;
  /** Always computed, regardless of which strategy won — the repair channel. */
  path: string;
  tag: string;
  textHint?: string;
}

export interface GenerateSelectorOptions {
  testIdAttributes?: string[];
  /** Scoping root for `querySelectorAll` uniqueness checks. Defaults to the element's document. */
  root?: ParentNode;
}

const DEFAULT_TEST_ID_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-cy'];

// Reject ids that look generated rather than authored:
//   /\d{4,}/     - long numeric runs ("item-38291")
//   /^[:r]/      - React's useId() output ("«r1»", ":r1:")
const UNSTABLE_ID_PATTERNS = [/\d{4,}/, /^[:r]/];

/**
 * Hex-hash detection for build-tool ids ("css-1x2y3z", "a3f9c2").
 *
 * A bare /[0-9a-f]{6,}/ is too eager: plenty of authored English words are
 * built entirely from a-f ("facade", "decade", "efface"), and rejecting those
 * pushes a perfectly stable id down to a fragile structural path. So we also
 * require the run to contain a digit. A randomly generated 6-char hex hash is
 * all-letters only ~0.2% of the time, making this trade heavily one-sided.
 */
function hasHashLikeRun(id: string): boolean {
  const runs = id.match(/[0-9a-f]{6,}/gi) ?? [];
  return runs.some((run) => /\d/.test(run));
}

/**
 * Catches non-hex generated ids that interleave letters and digits
 * ("css-1x2y3z", "s7k2p9"), which the hex rule above misses entirely.
 *
 * Counts letter<->digit transitions per `-`/`_` separated token. Authored ids
 * put digits at one end ("step1", "h1-heading", "section2") and score 1-2;
 * generated ones alternate and score much higher. The threshold of 3 keeps
 * every realistic authored form.
 */
function hasInterleavedDigits(id: string): boolean {
  return id.split(/[-_]/).some((token) => {
    if (token.length < 5 || !/\d/.test(token) || !/[a-z]/i.test(token)) return false;
    let transitions = 0;
    for (let i = 1; i < token.length; i += 1) {
      const previous = token[i - 1]!;
      const current = token[i]!;
      if (/\d/.test(previous) !== /\d/.test(current)) transitions += 1;
    }
    return transitions >= 3;
  });
}

const FORM_CONTROL_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON']);
const MAX_PATH_DEPTH = 8;

/**
 * Generates an anchor selector for `element` via the fallback chain from
 * plan §4: testid -> stable id -> name -> aria/role -> structural path ->
 * coords. The first candidate that matches EXACTLY ONE element in `root`
 * wins. The structural `path` is always computed and returned regardless of
 * which strategy wins, since it's the repair channel `resolveSelector` uses
 * when the winning selector stops matching.
 */
export function generateSelector(element: Element, options: GenerateSelectorOptions = {}): GeneratedSelector {
  const testIdAttributes = options.testIdAttributes ?? DEFAULT_TEST_ID_ATTRIBUTES;
  const root = options.root ?? element.ownerDocument ?? document;
  const tag = element.tagName;
  const textHint = getTextHint(element);
  const path = computeStructuralPath(element, testIdAttributes);

  // 1. testid
  for (const attr of testIdAttributes) {
    const value = element.getAttribute(attr);
    if (!value) continue;
    const selector = `[${attr}="${escapeAttrValue(value)}"]`;
    if (matchesExactlyOne(root, selector, element)) {
      return { strategy: 'testid', selector, path, tag, textHint };
    }
  }

  // 2. stable id
  const id = element.id;
  if (id && isStableId(id)) {
    const selector = `[id="${escapeAttrValue(id)}"]`;
    if (matchesExactlyOne(root, selector, element)) {
      return { strategy: 'id', selector, path, tag, textHint };
    }
  }

  // 3. form control name
  const name = element.getAttribute('name');
  if (name && FORM_CONTROL_TAGS.has(element.tagName)) {
    const selector = `${tag.toLowerCase()}[name="${escapeAttrValue(name)}"]`;
    if (matchesExactlyOne(root, selector, element)) {
      return { strategy: 'name', selector, path, tag, textHint };
    }
  }

  // 4. aria label / role
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    const selector = `${tag.toLowerCase()}[aria-label="${escapeAttrValue(ariaLabel)}"]`;
    if (matchesExactlyOne(root, selector, element)) {
      return { strategy: 'aria', selector, path, tag, textHint };
    }
  }
  const role = element.getAttribute('role');
  if (role) {
    const selector = ariaLabel
      ? `[role="${escapeAttrValue(role)}"][aria-label="${escapeAttrValue(ariaLabel)}"]`
      : `[role="${escapeAttrValue(role)}"]`;
    if (matchesExactlyOne(root, selector, element)) {
      return { strategy: 'aria', selector, path, tag, textHint };
    }
  }

  // 5. structural path
  if (matchesExactlyOne(root, path, element)) {
    return { strategy: 'path', selector: path, path, tag, textHint };
  }

  // 6. coords — nothing usable; position comes purely from stored page coordinates.
  return { strategy: 'coords', selector: 'body', path, tag, textHint };
}

function isStableId(id: string): boolean {
  return (
    !UNSTABLE_ID_PATTERNS.some((re) => re.test(id)) &&
    !hasHashLikeRun(id) &&
    !hasInterleavedDigits(id)
  );
}

/** First 40 chars of trimmed, whitespace-collapsed textContent — a disambiguator, not a selector. */
export function getTextHint(element: Element): string | undefined {
  const text = element.textContent?.trim().replace(/\s+/g, ' ');
  if (!text) return undefined;
  return text.slice(0, 40);
}

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function matchesExactlyOne(root: ParentNode, selector: string, element: Element): boolean {
  if (!selector) return false;
  let matches: NodeListOf<Element>;
  try {
    matches = root.querySelectorAll(selector);
  } catch {
    return false;
  }
  return matches.length === 1 && matches[0] === element;
}

/**
 * Walks up from `element`, joining `tag:nth-of-type(n)` segments with `>`.
 * Classes are excluded entirely (CSS-module/utility hashes are the single
 * biggest source of selector rot). Stops at the nearest ancestor that
 * itself resolves via a stable strategy (testid/id/name/aria), or at
 * `<body>`, or after 8 levels — whichever comes first.
 */
function computeStructuralPath(element: Element, testIdAttributes: string[]): string {
  const segments: string[] = [];
  let current: Element | null = element;
  let depth = 0;
  // Kept out of `segments` so the depth-cap trim below can never discard it.
  let stablePrefix: string | null = null;

  while (current && depth < MAX_PATH_DEPTH) {
    segments.unshift(segmentFor(current));
    depth += 1;

    if (current.tagName === 'BODY') break;

    const parent: Element | null = current.parentElement;
    if (!parent) break;

    const stableSelector = stableSelectorFor(parent, testIdAttributes);
    if (stableSelector) {
      stablePrefix = stableSelector;
      break;
    }

    current = parent;
  }

  // Trim from the FRONT (shallowest segments are the least identifying), but
  // the stable-ancestor prefix always survives: it is the whole reason the
  // path is anchored rather than a floating `div > div > span` chain that
  // matches half the page. Trimming it away — as slicing a combined array
  // would — discards exactly the segment worth keeping.
  const trimmed = segments.slice(-MAX_PATH_DEPTH);
  return (stablePrefix ? [stablePrefix, ...trimmed] : trimmed).join(' > ');
}

/**
 * Mirrors the testid/id/name/aria priority of the main chain (steps 1–4),
 * but only to check/produce a stopping point for the structural walk — it
 * never falls through to path/coords itself.
 */
function stableSelectorFor(element: Element, testIdAttributes: string[]): string | null {
  for (const attr of testIdAttributes) {
    const value = element.getAttribute(attr);
    if (value) return `[${attr}="${escapeAttrValue(value)}"]`;
  }
  if (element.id && isStableId(element.id)) {
    return `[id="${escapeAttrValue(element.id)}"]`;
  }
  const name = element.getAttribute('name');
  if (name && FORM_CONTROL_TAGS.has(element.tagName)) {
    return `${element.tagName.toLowerCase()}[name="${escapeAttrValue(name)}"]`;
  }
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return `${element.tagName.toLowerCase()}[aria-label="${escapeAttrValue(ariaLabel)}"]`;
  }
  return null;
}

function segmentFor(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const parent = element.parentElement;
  if (!parent) return tag;

  const siblingsOfType = Array.from(parent.children).filter((c) => c.tagName === element.tagName);
  if (siblingsOfType.length <= 1) return tag;

  const index = siblingsOfType.indexOf(element) + 1;
  return `${tag}:nth-of-type(${index})`;
}
