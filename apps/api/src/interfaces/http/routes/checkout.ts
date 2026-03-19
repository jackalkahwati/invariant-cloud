/**
 * Stripe Checkout Routes
 *
 * POST /checkout/session  — create a Stripe Checkout session (Team tier)
 * POST /checkout/webhook  — handle Stripe webhook events
 */

import type { FastifyInstance } from 'fastify';
import Stripe from 'stripe';
import { prisma } from '../../../infrastructure/database/prisma.js';
import { stripeConfig } from '../../../infrastructure/config.js';
import { sendTeamActivationEmail } from '../../../application/services/EmailService.js';

function getStripe(): Stripe | null {
  if (!stripeConfig.secretKey) return null;
  return new Stripe(stripeConfig.secretKey, { apiVersion: '2026-02-25.clover' });
}

export async function checkoutRoutes(app: FastifyInstance) {
  app.post<{ Body?: { workspaceId?: string; email?: string; tier?: 'team' | 'enterprise' } }>('/checkout/session', {
    schema: {
      tags: ['Billing'],
      summary: 'Create a Stripe Checkout session (team or enterprise tier)',
      body: {
        type: 'object',
        properties: {
          workspaceId: { type: 'string' },
          email:       { type: 'string' },
          tier:        { type: 'string', enum: ['team', 'enterprise'] },
        },
      },
    },
  }, async (req, reply) => {
    const stripe = getStripe();
    if (!stripe) return reply.status(503).send({ error: 'Stripe is not configured. Set STRIPE_SECRET_KEY.' });

    const tier = req.body?.tier ?? 'team';
    const priceId = tier === 'enterprise' ? stripeConfig.enterprisePriceId : stripeConfig.teamPriceId;

    if (!priceId) return reply.status(503).send({
      error: `STRIPE_${tier.toUpperCase()}_PRICE_ID is not set. Create a recurring price in your Stripe dashboard.`,
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { tier },
      },
      client_reference_id: req.body?.workspaceId,
      customer_email:      req.body?.email,
      success_url: stripeConfig.successUrl,
      cancel_url:  stripeConfig.cancelUrl,
    });

    return reply.send({ url: session.url });
  });

  app.post('/checkout/webhook', {
    config: { rawBody: true },
    schema: { tags: ['Billing'], summary: 'Stripe webhook endpoint' },
  }, async (req, reply) => {
    const stripe = getStripe();
    if (!stripe) return reply.status(503).send({ error: 'Stripe not configured' });

    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = stripeConfig.webhookSecret;
    let event: Stripe.Event;

    if (webhookSecret) {
      try {
        const rawBody = (req as unknown as { rawBody: Buffer }).rawBody;
        event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
      } catch (err) {
        app.log.error({ err }, 'Stripe webhook signature verification failed');
        return reply.status(400).send({ error: 'Invalid signature' });
      }
    } else {
      event = (req as unknown as { body: Stripe.Event }).body;
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const workspaceId = session.client_reference_id;
        if (workspaceId) {
          // Retrieve subscription to read the tier metadata we embedded
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          const tierMeta = sub.metadata?.tier ?? 'team';
          const newTier = tierMeta === 'enterprise' ? 'ENTERPRISE' : 'TEAM';

          const workspace = await prisma.workspace.update({
            where: { id: workspaceId },
            data: {
              tier:                 newTier,
              status:               'TRIAL',
              stripeCustomerId:     session.customer as string,
              stripeSubscriptionId: session.subscription as string,
              trialEndsAt:          new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            },
            include: { members: { where: { role: 'OWNER' }, include: { user: true } } },
          });
          const ownerEmail = workspace.members[0]?.user?.email;
          if (ownerEmail) sendTeamActivationEmail(ownerEmail, workspace.name).catch(() => {});
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        await prisma.workspace.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data:  { tier: 'FREE', status: 'CANCELLED', stripeSubscriptionId: null },
        });
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const status = sub.status === 'active' ? 'ACTIVE' : sub.status === 'trialing' ? 'TRIAL' : 'PAST_DUE';
        await prisma.workspace.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data:  { status: status as 'ACTIVE' | 'TRIAL' | 'PAST_DUE' },
        });
        break;
      }
      default:
        app.log.debug({ type: event.type }, 'Unhandled Stripe event');
    }

    return reply.send({ received: true });
  });
}
