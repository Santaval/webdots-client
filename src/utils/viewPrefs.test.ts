import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  annotationsHiddenKey,
  loadAnnotationsHidden,
  saveAnnotationsHidden,
  toolbarPositionKey,
  loadToolbarPosition,
  saveToolbarPosition,
} from './viewPrefs';

describe('viewPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('annotationsHiddenKey', () => {
    it('namespaces by apiUrl alone', () => {
      expect(annotationsHiddenKey('https://api.test/v1')).toBe(
        'webdots:view:annotations-hidden:https://api.test/v1',
      );
    });

    it('produces distinct keys per apiUrl', () => {
      const a = annotationsHiddenKey('https://api.test/v1');
      const b = annotationsHiddenKey('https://api.test/v2');
      expect(new Set([a, b]).size).toBe(2);
    });
  });

  describe('saveAnnotationsHidden / loadAnnotationsHidden round-trip', () => {
    it('persists and restores true', () => {
      saveAnnotationsHidden('https://api.test/v1', true);
      expect(loadAnnotationsHidden('https://api.test/v1')).toBe(true);
    });

    it('persists and restores false', () => {
      saveAnnotationsHidden('https://api.test/v1', false);
      expect(loadAnnotationsHidden('https://api.test/v1')).toBe(false);
    });

    it('returns null when no preference exists for the namespace', () => {
      expect(loadAnnotationsHidden('https://api.test/v1')).toBeNull();
    });

    it('keeps preferences for different apiUrls isolated', () => {
      saveAnnotationsHidden('https://api.test/v1', true);
      saveAnnotationsHidden('https://api.test/v2', false);
      expect(loadAnnotationsHidden('https://api.test/v1')).toBe(true);
      expect(loadAnnotationsHidden('https://api.test/v2')).toBe(false);
    });
  });

  describe('corruption tolerance', () => {
    it('returns null (rather than throwing) on a garbage stored value', () => {
      localStorage.setItem(annotationsHiddenKey('https://api.test/v1'), 'not-a-flag');
      expect(loadAnnotationsHidden('https://api.test/v1')).toBeNull();
    });
  });

  describe('storage absence', () => {
    it('loadAnnotationsHidden returns null when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(loadAnnotationsHidden('https://api.test/v1')).toBeNull();
    });

    it('saveAnnotationsHidden is a no-op (no throw) when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => saveAnnotationsHidden('https://api.test/v1', true)).not.toThrow();
    });
  });

  // Issue #21: the floating toolbar's position — a corner (bare string) or a
  // dragged { x, y } point (JSON), namespaced by apiUrl like every other
  // view preference so it survives reloads and same-site navigation.
  describe('toolbarPositionKey', () => {
    it('namespaces by apiUrl alone', () => {
      expect(toolbarPositionKey('https://api.test/v1')).toBe(
        'webdots:view:toolbar-position:https://api.test/v1',
      );
    });

    it('stays distinct from the annotations-hidden key for the same apiUrl', () => {
      expect(toolbarPositionKey('https://api.test/v1')).not.toBe(annotationsHiddenKey('https://api.test/v1'));
    });
  });

  describe('saveToolbarPosition / loadToolbarPosition round-trip', () => {
    it('persists and restores a corner as the bare corner string', () => {
      saveToolbarPosition('https://api.test/v1', 'top-left');
      expect(loadToolbarPosition('https://api.test/v1')).toBe('top-left');
      // Corners never serialize as JSON — the two halves of the union stay
      // unambiguous on disk.
      expect(localStorage.getItem(toolbarPositionKey('https://api.test/v1'))).toBe('top-left');
    });

    it('persists and restores a dragged point', () => {
      saveToolbarPosition('https://api.test/v1', { x: 240, y: 136 });
      expect(loadToolbarPosition('https://api.test/v1')).toEqual({ x: 240, y: 136 });
    });

    it('returns null when no preference exists for the namespace', () => {
      expect(loadToolbarPosition('https://api.test/v1')).toBeNull();
    });

    it('keeps positions for different apiUrls isolated', () => {
      saveToolbarPosition('https://api.test/v1', 'bottom-left');
      saveToolbarPosition('https://api.test/v2', { x: 10, y: 20 });
      expect(loadToolbarPosition('https://api.test/v1')).toBe('bottom-left');
      expect(loadToolbarPosition('https://api.test/v2')).toEqual({ x: 10, y: 20 });
    });
  });

  describe('toolbar position corruption tolerance', () => {
    it('returns null on a non-corner, non-JSON string', () => {
      localStorage.setItem(toolbarPositionKey('https://api.test/v1'), 'somewhere-nice');
      expect(loadToolbarPosition('https://api.test/v1')).toBeNull();
    });

    it('returns null on JSON that is not a finite { x, y } point', () => {
      localStorage.setItem(toolbarPositionKey('https://api.test/v1'), '{"x":"left","y":10}');
      expect(loadToolbarPosition('https://api.test/v1')).toBeNull();
      localStorage.setItem(toolbarPositionKey('https://api.test/v1'), '{"x":10}');
      expect(loadToolbarPosition('https://api.test/v1')).toBeNull();
    });

    it('returns null on truncated JSON', () => {
      localStorage.setItem(toolbarPositionKey('https://api.test/v1'), '{"x":24');
      expect(loadToolbarPosition('https://api.test/v1')).toBeNull();
    });
  });

  describe('toolbar position storage absence', () => {
    it('loadToolbarPosition returns null when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(loadToolbarPosition('https://api.test/v1')).toBeNull();
    });

    it('saveToolbarPosition is a no-op (no throw) when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => saveToolbarPosition('https://api.test/v1', { x: 1, y: 2 })).not.toThrow();
    });
  });
});
