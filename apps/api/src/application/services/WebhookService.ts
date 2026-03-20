/**
 * WebhookService, fire-and-forget outbound webhook delivery.
 *
 * Maintains an in-memory registry of webhook subscriptions.
 * When dispatch() is called with an event name and payload, it
 * fans out to all registered hooks subscribed to that event,
 * signing each request with HMAC-SHA256 when a secret is present.
 */

import { createHmac, randomUUID } from 'node:crypto';

export type WebhookEvent =
  | 'action.blocked'
  | 'action.valid'
  | 'contradiction.detected'
  | 'coherence.drop'
  | 'plan.failed';

export interface WebhookRegistration {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
  createdAt: Date;
}

// In-memory store, will be replaced with DB persistence later.
const store = new Map<string, WebhookRegistration>();

export class WebhookService {
  /** Register a new webhook. */
  register(data: { url: string; events: WebhookEvent[]; secret?: string }): WebhookRegistration {
    const registration: WebhookRegistration = {
      id: randomUUID(),
      url: data.url,
      events: data.events,
      secret: data.secret,
      createdAt: new Date(),
    };
    store.set(registration.id, registration);
    return registration;
  }

  /** List all registered webhooks. */
  list(): WebhookRegistration[] {
    return Array.from(store.values());
  }

  /** Find a single webhook by ID. */
  findById(id: string): WebhookRegistration | undefined {
    return store.get(id);
  }

  /** Remove a webhook by ID. Returns true if it existed. */
  remove(id: string): boolean {
    return store.delete(id);
  }

  /**
   * Dispatch an event to all subscribed webhooks.
   * Fire-and-forget: does not await delivery, silently swallows errors.
   */
  dispatch(event: WebhookEvent, payload: object): void {
    const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

    for (const registration of store.values()) {
      if (!registration.events.includes(event)) continue;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Invariant-Event': event,
      };

      if (registration.secret) {
        const sig = createHmac('sha256', registration.secret).update(body).digest('hex');
        headers['X-Invariant-Signature'] = `sha256=${sig}`;
      }

      // Fire-and-forget
      fetch(registration.url, { method: 'POST', headers, body })
        .catch(() => { /* silently ignore delivery failures */ });
    }
  }

  /**
   * Send a single test payload to a specific webhook.
   * Returns true if the delivery was attempted (2xx), false otherwise.
   */
  async test(id: string): Promise<{ ok: boolean; status?: number; error?: string }> {
    const registration = store.get(id);
    if (!registration) return { ok: false, error: 'Webhook not found' };

    const body = JSON.stringify({
      event: 'test',
      payload: { message: 'This is a test payload from the Coherence Engine.' },
      timestamp: new Date().toISOString(),
    });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Invariant-Event': 'test',
    };

    if (registration.secret) {
      const sig = createHmac('sha256', registration.secret).update(body).digest('hex');
      headers['X-Invariant-Signature'] = `sha256=${sig}`;
    }

    try {
      const res = await fetch(registration.url, { method: 'POST', headers, body });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }
}
