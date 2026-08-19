import {
  init,
  type WidgetHandle,
  type AnnotationAPI,
  type Annotation,
  type AnnotationStatus,
  type ListAnnotationsQuery,
  type CreateAnnotationInput,
  type UpdateAnnotationInput,
} from '../src/index';

declare global {
  interface Window {
    __webdots?: WidgetHandle;
    __webdotsApi?: AnnotationAPI;
  }
}

/**
 * A trivial in-memory stub `AnnotationAPI` so this demo works standalone —
 * no live `webdots` backend required. Real integration (the plan's
 * "Backend integration" verification step) is done manually by running
 * `webdots` locally, adding this demo's origin to `devOrigins`, and
 * removing the `api` override below so `apiUrl` is used instead.
 */
function createStubApi(): AnnotationAPI {
  const rows = new Map<string, Annotation>();
  let counter = 0;

  const clone = (a: Annotation): Annotation => ({ ...a });

  return {
    async list(query: ListAnnotationsQuery): Promise<Annotation[]> {
      let all = Array.from(rows.values());
      if (query.pageUrl) all = all.filter((a) => a.pageUrl === query.pageUrl);
      if (query.status) all = all.filter((a) => a.status === query.status);
      if (query.priority) all = all.filter((a) => a.priority === query.priority);
      return all.map(clone);
    },

    async get(id: string): Promise<Annotation> {
      const found = rows.get(id);
      if (!found) throw new Error(`[demo stub] annotation not found: ${id}`);
      return clone(found);
    },

    async create(input: CreateAnnotationInput): Promise<Annotation> {
      counter += 1;
      const now = new Date().toISOString();
      const annotation: Annotation = {
        id: `stub_${counter}`,
        pageUrl: input.pageUrl,
        selector: input.selector,
        x: input.x,
        y: input.y,
        anchor: input.anchor,
        title: input.title,
        description: input.description,
        status: 'OPEN',
        priority: input.priority ?? 'MEDIUM',
        authorName: input.authorName,
        authorEmail: input.authorEmail,
        screenshot: null,
        resolvedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      rows.set(annotation.id, annotation);
      return clone(annotation);
    },

    async update(id: string, input: UpdateAnnotationInput): Promise<Annotation> {
      const existing = rows.get(id);
      if (!existing) throw new Error(`[demo stub] annotation not found: ${id}`);
      const updated: Annotation = { ...existing, ...input, updatedAt: new Date().toISOString() };
      rows.set(id, updated);
      return clone(updated);
    },

    async changeStatus(id: string, status: AnnotationStatus): Promise<Annotation> {
      const existing = rows.get(id);
      if (!existing) throw new Error(`[demo stub] annotation not found: ${id}`);
      const updated: Annotation = {
        ...existing,
        status,
        resolvedAt: status === 'RESOLVED' ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      };
      rows.set(id, updated);
      return clone(updated);
    },

    async remove(id: string): Promise<void> {
      rows.delete(id);
    },
  };
}

const api = createStubApi();

const handle = init({
  apiUrl: 'http://localhost:3000/api/v1',
  user: { name: 'Demo QA', email: 'qa@example.com' },
  debug: true,
  api,
});

// Expose for console poking: window.__webdots.setMode('annotate'), etc.
window.__webdots = handle;
// Expose the stub API too, so a manual QA pass (M5's "force an API failure"
// verification step) can inject a failure without touching source, e.g.:
//   window.__webdotsApi.create = () => Promise.reject(new Error('Simulated failure'));
window.__webdotsApi = api;
