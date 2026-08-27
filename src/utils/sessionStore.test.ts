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
    it('namespaces by apiUrl + pageKey with a | separator', () => {
      expect(sessionKey('https://api.test/v1', 'https://host.example/page')).toBe(
        'webdots:session:https://api.test/v1|https://host.example/page',
      );
    });

    it('produces distinct keys per apiUrl (same page) and per pageKey (same api)', () => {
      const a = sessionKey('https://api.test/v1', 'https://host.example/p1');
      const b = sessionKey('https://api.test/v1', 'https://host.example/p2');
      const c = sessionKey('https://api.test/v2', 'https://host.example/p1');
      expect(new Set([a, b, c]).size).toBe(3);
    });
  });

  describe('saveSession / loadSession round-trip', () => {
    it('persists and restores a full session (token + user)', () => {
      saveSession('https://api.test/v1', 'https://host.example/page', session);
      expect(loadSession('https://api.test/v1', 'https://host.example/page')).toEqual(session);
    });

    it('returns null when no session exists for the namespace', () => {
      expect(loadSession('https://api.test/v1', 'https://host.example/page')).toBeNull();
    });

    it('keeps sessions for different namespaces isolated', () => {
      saveSession('https://api.test/v1', 'https://host.example/p1', session);
      saveSession('https://api.test/v1', 'https://host.example/p2', {
        token: 'tok_456',
        user: { name: 'Bob', email: 'bob@example.com' },
      });
      expect(loadSession('https://api.test/v1', 'https://host.example/p1')!.token).toBe('tok_123');
      expect(loadSession('https://api.test/v1', 'https://host.example/p2')!.token).toBe('tok_456');
    });
  });

  describe('clearSession', () => {
    it('removes only the targeted namespace', () => {
      saveSession('https://api.test/v1', 'https://host.example/p1', session);
      saveSession('https://api.test/v1', 'https://host.example/p2', {
        token: 'tok_456',
        user: { name: 'Bob', email: 'bob@example.com' },
      });
      clearSession('https://api.test/v1', 'https://host.example/p1');
      expect(loadSession('https://api.test/v1', 'https://host.example/p1')).toBeNull();
      expect(loadSession('https://api.test/v1', 'https://host.example/p2')!.token).toBe('tok_456');
    });

    it('is a no-op (no throw) when nothing is stored', () => {
      expect(() => clearSession('https://api.test/v1', 'https://host.example/page')).not.toThrow();
    });
  });

  describe('corruption tolerance', () => {
    it('returns null (rather than throwing) on non-JSON storage content', () => {
      localStorage.setItem(
        sessionKey('https://api.test/v1', 'https://host.example/page'),
        'not json at all',
      );
      expect(loadSession('https://api.test/v1', 'https://host.example/page')).toBeNull();
    });

    it('returns null on JSON that does not match the session shape', () => {
      localStorage.setItem(
        sessionKey('https://api.test/v1', 'https://host.example/page'),
        JSON.stringify({ unrelated: 'payload' }),
      );
      expect(loadSession('https://api.test/v1', 'https://host.example/page')).toBeNull();
    });

    it('returns null when token is missing from the stored object', () => {
      localStorage.setItem(
        sessionKey('https://api.test/v1', 'https://host.example/page'),
        JSON.stringify({ user: { name: 'Ada' } }),
      );
      expect(loadSession('https://api.test/v1', 'https://host.example/page')).toBeNull();
    });

    it('returns null when user.name is missing', () => {
      localStorage.setItem(
        sessionKey('https://api.test/v1', 'https://host.example/page'),
        JSON.stringify({ token: 'tok', user: {} }),
      );
      expect(loadSession('https://api.test/v1', 'https://host.example/page')).toBeNull();
    });
  });

  describe('storage absence', () => {
    it('loadSession returns null when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(loadSession('https://api.test/v1', 'https://host.example/page')).toBeNull();
    });

    it('saveSession and clearSession are no-ops when localStorage is unavailable', () => {
      vi.stubGlobal('localStorage', undefined);
      expect(() => saveSession('https://api.test/v1', 'https://host.example/page', session)).not.toThrow();
      expect(() => clearSession('https://api.test/v1', 'https://host.example/page')).not.toThrow();
    });
  });
});
