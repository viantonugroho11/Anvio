export interface AuthContext {
  userId: string;
  email?: string;
  roles: string[];
  provider: string;
}

export interface AuthProvider {
  readonly enabled: boolean;
  authenticate(token?: string): Promise<AuthContext | null>;
  /** Returns default anonymous context when auth is disabled. */
  getDefaultContext(): AuthContext;
}
