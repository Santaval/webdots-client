import { describe, it, expect } from 'vitest';
import { annotationFromWire, toCreateBody, toUpdateBody, type AnnotationWire } from './dto';
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

  it('passes through a valid input unchanged (plus always including anchor)', () => {
    const body = toCreateBody(validInput);
    expect(body.pageUrl).toBe(validInput.pageUrl);
    expect(body.anchor).toEqual(anchor);
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
