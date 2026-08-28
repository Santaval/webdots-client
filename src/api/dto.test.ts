import { describe, it, expect } from 'vitest';
import { annotationFromWire, toCreateBody, toScreenshotBody, toUpdateBody, type AnnotationWire } from './dto';
import type { AnchorDescriptor } from '../anchor/types';
import type { CreateAnnotationInput, UpdateAnnotationInput } from './AnnotationAPI';

const anchor: AnchorDescriptor = {
  v: 1,
  strategy: 'testid',
  selector: '[data-testid="x"]',
  path: '[data-testid="x"]',
  ratio: { x: 0.5, y: 0.5 },
  viewportW: 1024,
  tag: 'BUTTON',
};

function makeWire(overrides: Partial<AnnotationWire> = {}): AnnotationWire {
  return {
    id: 'srv_1',
    pageUrl: 'https://example.com/page',
    selector: 'button',
    x: 10,
    y: 20,
    title: 'Broken button',
    status: 'OPEN',
    priority: 'MEDIUM',
    authorName: 'QA',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('annotationFromWire', () => {
  it('round-trips a wire row that already carries a well-formed anchor', () => {
    const wire = makeWire({ anchor });
    const result = annotationFromWire(wire);

    expect(result.anchor).toEqual(anchor);
    expect(result.id).toBe('srv_1');
    expect(result.title).toBe('Broken button');
    expect(result.status).toBe('OPEN');
  });

  it('synthesizes a coords fallback when `anchor` is entirely absent (the live backend today)', () => {
    const wire = makeWire(); // no `anchor` key at all
    const result = annotationFromWire(wire);

    expect(result.anchor).not.toBeNull();
    expect(result.anchor!.strategy).toBe('coords');
    expect(result.anchor!.selector).toBe(wire.selector);
    expect(result.anchor!.ratio).toEqual({ x: 0.5, y: 0.5 });
  });

  it('synthesizes a coords fallback when `anchor` is explicitly null (a future legacy row)', () => {
    const wire = makeWire({ anchor: null });
    const result = annotationFromWire(wire);

    expect(result.anchor!.strategy).toBe('coords');
  });

  it('synthesizes a coords fallback when `anchor` is malformed JSON garbage', () => {
    const wire = makeWire({ anchor: { some: 'unexpected shape' } });
    const result = annotationFromWire(wire);

    expect(result.anchor!.strategy).toBe('coords');
  });

  it('maps null description/authorEmail/screenshot/resolvedAt to the internal model correctly', () => {
    const wire = makeWire({ description: null, authorEmail: null, screenshot: null, resolvedAt: null });
    const result = annotationFromWire(wire);

    expect(result.description).toBeUndefined();
    expect(result.authorEmail).toBeUndefined();
    expect(result.screenshot).toBeNull();
    expect(result.resolvedAt).toBeNull();
  });
});

describe('toCreateBody', () => {
  const validInput: CreateAnnotationInput = {
    pageUrl: 'https://example.com/page',
    selector: 'button',
    x: 1,
    y: 2,
    anchor,
    title: 'Title',
    authorName: 'QA',
  };

  it('passes through a valid input unchanged (plus always including anchor, remapped to the wire `version` field)', () => {
    const body = toCreateBody(validInput);
    expect(body.pageUrl).toBe(validInput.pageUrl);
    const { v, ...rest } = anchor;
    expect(body.anchor).toEqual({ ...rest, version: v });
  });

  it('rejects a pageUrl that is not a parseable URL', () => {
    expect(() => toCreateBody({ ...validInput, pageUrl: 'not-a-url' })).toThrow(/valid absolute URL/);
  });

  it('rejects a pageUrl exceeding 512 characters', () => {
    const longUrl = `https://example.com/${'a'.repeat(500)}`;
    expect(longUrl.length).toBeGreaterThan(512);
    expect(() => toCreateBody({ ...validInput, pageUrl: longUrl })).toThrow(/512-character limit/);
  });

  it('rejects a selector exceeding 512 characters', () => {
    const longSelector = 'div > '.repeat(100) + 'span';
    expect(longSelector.length).toBeGreaterThan(512);
    expect(() => toCreateBody({ ...validInput, selector: longSelector })).toThrow(/512-character limit/);
  });

  it('accepts a selector/pageUrl right at the 512-character boundary', () => {
    const exactUrl = `https://example.com/${'a'.repeat(512 - 'https://example.com/'.length)}`;
    expect(exactUrl.length).toBe(512);
    expect(() => toCreateBody({ ...validInput, pageUrl: exactUrl })).not.toThrow();
  });

  it('omits authorName/authorEmail from the body when the input carries none (signed-in path, #6)', () => {
    const input: CreateAnnotationInput = {
      pageUrl: 'https://example.com/page',
      selector: 'button',
      x: 1,
      y: 2,
      anchor,
      title: 'Title',
    };
    const body = toCreateBody(input);
    // Keys must be genuinely absent (not `undefined`-valued) so they never
    // reach the wire when a JWT session is active — the server derives
    // authorship from the session instead.
    expect(body).not.toHaveProperty('authorName');
    expect(body).not.toHaveProperty('authorEmail');
  });

  it('includes authorName/authorEmail when supplied (anonymous-mode fallback, #6)', () => {
    const body = toCreateBody({ ...validInput, authorEmail: 'qa@example.com' });
    expect(body.authorName).toBe('QA');
    expect(body.authorEmail).toBe('qa@example.com');
  });
});

describe('toUpdateBody', () => {
  it('passes through a partial update unchanged', () => {
    const input: UpdateAnnotationInput = { title: 'New title', priority: 'HIGH' };
    const body = toUpdateBody(input);
    expect(body).toEqual({
      title: 'New title',
      description: undefined,
      priority: 'HIGH',
      selector: undefined,
      x: undefined,
      y: undefined,
      anchor: undefined,
    });
  });

  it('rejects an updated selector exceeding 512 characters', () => {
    const longSelector = 'div > '.repeat(100) + 'span';
    expect(() => toUpdateBody({ selector: longSelector })).toThrow(/512-character limit/);
  });

  it('does not validate pageUrl shape (UpdateAnnotationInput never carries pageUrl)', () => {
    expect(() => toUpdateBody({ title: 'x' })).not.toThrow();
  });
});

describe('toScreenshotBody (#8)', () => {
  const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0x8AAAAASUVORK5CYII=';

  it('wraps a valid image data URL in { image } unchanged', () => {
    const body = toScreenshotBody(pngDataUrl);
    expect(body).toEqual({ image: pngDataUrl });
  });

  it('accepts other image subtypes (jpeg, webp, svg+xml)', () => {
    expect(() => toScreenshotBody('data:image/jpeg;base64,/9j/4AAQ')).not.toThrow();
    expect(() => toScreenshotBody('data:image/webp;base64,UklGRkBAA')).not.toThrow();
    expect(() => toScreenshotBody('data:image/svg+xml;base64,PHN2Zz4=')).not.toThrow();
  });

  it('rejects a non-image MIME type (e.g. text/plain)', () => {
    expect(() => toScreenshotBody('data:text/plain;base64,aGVsbG8=')).toThrow(/image MIME type/);
  });

  it('rejects a data URL missing the ;base64 marker', () => {
    // `data:image/png,...` (percent-encoded, not base64) is not the agreed shape.
    expect(() => toScreenshotBody('data:image/png,foo')).toThrow(/data:image\/\*;base64/);
  });

  it('rejects a plain non-data URL', () => {
    expect(() => toScreenshotBody('https://example.com/screenshot.png')).toThrow(/data:image\/\*;base64/);
  });

  it('rejects an empty string', () => {
    expect(() => toScreenshotBody('')).toThrow(/non-empty data: URL/);
  });

  it('rejects a payload exceeding the 2 MB ceiling, fail-fast before any network call', () => {
    // Build a >2MB string that still has a valid image-data-URL prefix.
    const oversized = `data:image/png;base64,${'A'.repeat(2 * 1024 * 1024 + 1)}`;
    expect(oversized.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(() => toScreenshotBody(oversized)).toThrow(/2\d+-byte upload limit/);
  });

  it('accepts a payload right at the 2 MB boundary', () => {
    // Exact-length: prefix + base64 such that the whole string == 2*1024*1024.
    const prefix = 'data:image/png;base64,';
    const exact = prefix + 'A'.repeat(2 * 1024 * 1024 - prefix.length);
    expect(exact.length).toBe(2 * 1024 * 1024);
    expect(() => toScreenshotBody(exact)).not.toThrow();
  });
});
