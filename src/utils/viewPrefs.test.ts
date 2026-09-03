import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { annotationsHiddenKey, loadAnnotationsHidden, saveAnnotationsHidden } from './viewPrefs';

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
});
