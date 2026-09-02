import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { sessionKey, loadSession, saveSession, clearSession } from './sessionStore';
import type { MagicLinkSession } from '../api/AuthAPI';

const session: MagicLinkSession = {
  token: 'tok_123',
  user: { name: 'Ada', email: 'ada@example.com' },
};

describe('sessionStore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('sessionKey', () => {
    it('namespaces by apiUrl alone', () => {
      expect(sessionKey('https://api.test/v1')).toBe('webdots:session:https://api.test/v1');
    });

    it('produces distinct keys per apiUrl', () => {
      const a = sessionKey('https://api.test/v1');
      const b = sessionKey('https://api.test/v2');
      expect(new Set([a, b]).size).toBe(2);
    });
  });

  describe('saveSession / loadSession round-trip', () => {
    it('persists and restores a full session (token + user)', () => {
      saveSession('https://api.test/v1', session);
      expect(loadSession('https://api.test/v1')).toEqual(session);
    });

    it('returns null when no session exists for the namespace', () => {
      expect(loadSession('https://api.test/v1')).toBeNull();
    });

    it('keeps sessions for different apiUrls isolated', () => {
      saveSession('https://api.test/v1', session);
      saveSession('https://api.test/v2', {
        token: 'tok_456',
        user: { name: 'Bob', email: 'bob@example.com' },
      });
      expect(loadSession('https://api.test/v1')!.token).toBe('tok_123');
      expect(loadSession('https://api.test/v2')!.token).toBe('tok_456');
    });

    // Issue #18 regression: a session is identity, not per-page state — once
    // saved under an apiUrl, it's readable regardless of what page on the
    // site is current (there's no pageKey argument to even pass anymore). A
    // second apiUrl remains its own, isolated namespace.
    it('is readable regardless of the current page (issue #18)', () => {
      saveSession('https://api.test/v1', session);
      expect(loadSession('https://api.test/v1')).toEqual(session);
      expect(loadSession('https://api.test/v2')).toBeNull();
    });
  });

  describe('clearSession', () => {
    it('removes only the targeted namespace', () => {
      saveSession('https://api.test/v1', session);
      saveSession('https://api.test/v2', {
        token: 'tok_456',
        user: { name: 'Bob', email: 'bob@example.com' },
      });
      clearSession('https://api.test/v1');
      expect(loadSession('https://api.test/v1')).toBeNull();
      expect(loadSession('https://api.test/v2')!.token).toBe('tok_456');
    });

    it('is a no-op (no throw) when nothing is stored', () => {
      expect(() => clearSession('https://api.test/v1')).not.toThrow();
    });
  });

  describe('corruption tolerance', () => {
    it('returns null (rather than throwing) on non-JSON storage content', () => {
      localStorage.setItem(sessionKey('https://api.test/v1'), 'not json at all');
      expect(loadSession('https://api.test/v1')).toBeNull();
    });

    it('returns null on JSON that does not match the session shape', () => {
      localStorage.setItem(sessionKey('https://api.test/v1'), JSON.stringify({ unrelated: 'payload' }));
      expect(loadSession('https://api.test/v1')).toBeNull();
    });

    it('returns null when token is missing from the stored object', () => {
      localStorage.setItem(sessionKey('https://api.test/v1'), JSON.stringify({ user: { name: 'Ada' } }));
      expect(loadSession('https://api.test/v1')).toBeNull();
    });

    it('returns null when user.name is missing', () => {
      localStorage.setItem(sessionKey('https://api.test/v1'), JSON.stringify({ token: 'tok', user: {} }));
      expect(loadSession('https://api.test/v1')).toBeNull();
    });
  });

  describe('storage absence', () => {
    it('loadSession returns null when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(loadSession('https://api.test/v1')).toBeNull();
    });

    it('saveSession and clearSession are no-ops when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => saveSession('https://api.test/v1', session)).not.toThrow();
      expect(() => clearSession('https://api.test/v1')).not.toThrow();
    });
  });
});
