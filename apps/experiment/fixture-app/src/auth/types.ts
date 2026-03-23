/**
 * Types for SSO and authentication
 */

export interface SSOProviderConfig {
  type: 'saml' | 'oidc';
  clientId?: string;
  clientSecret?: string;
  issuer?: string;
  redirectUri?: string;
}

export interface SSOCallbackPayload {
  provider: string;
  userId: string;
  email: string;
  attributes?: Record<string, any>;
}

export interface TokenExchangeRequest {
  code?: string;
  samlResponse?: string;
  idToken?: string;
}

export interface TokenExchangeResponse {
  sessionId: string;
  accessToken: string;
  expiresIn: number;
}

export interface SSOSession {
  sessionId: string;
  userId: string;
  email: string;
  provider: string;
  createdAt: number;
  expiresAt: number;
}
