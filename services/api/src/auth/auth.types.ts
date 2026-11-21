export interface OidcPrincipal {
  issuer: string;
  subject: string;
  audience: string[];
  email?: string;
  emailVerified?: boolean;
}

export interface AuthenticatedRequest {
  auth?: OidcPrincipal;
  userId?: string;
  sessionId?: string;
}
