import { Clerk } from "@clerk/clerk-js";

export interface AuthSnapshot {
  status: "disabled" | "loading" | "signed_out" | "signed_in";
  isEnabled: boolean;
  isLoaded: boolean;
  userId: string | null;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
}

type AuthListener = (snapshot: AuthSnapshot) => void | Promise<void>;

const DEFAULT_SNAPSHOT: AuthSnapshot = {
  status: "loading",
  isEnabled: false,
  isLoaded: false,
  userId: null,
  email: null,
  displayName: "Guest",
  avatarUrl: null,
};

class AuthService {
  private clerk: Clerk | null = null;
  private snapshot: AuthSnapshot = { ...DEFAULT_SNAPSHOT };
  private listeners = new Set<AuthListener>();
  private initPromise: Promise<void> | null = null;
  private unsubscribe: (() => void) | null = null;

  async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.load();
    return this.initPromise;
  }

  getSnapshot(): AuthSnapshot {
    return this.snapshot;
  }

  subscribe(listener: AuthListener): () => void {
    this.listeners.add(listener);
    void listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  isEnabled(): boolean {
    return !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  }

  async getSessionToken(): Promise<string | null> {
    await this.init();
    if (!this.clerk?.session) return null;
    return (await this.clerk.session.getToken()) ?? null;
  }

  async openSignIn(): Promise<void> {
    if (!this.clerk) return;
    await this.clerk.redirectToSignIn({
      signInFallbackRedirectUrl: window.location.href,
      signUpFallbackRedirectUrl: window.location.href,
    });
  }

  async signOut(): Promise<void> {
    if (!this.clerk) return;
    await this.clerk.signOut({
      redirectUrl: window.location.href,
    });
  }

  getClerk(): Clerk | null {
    return this.clerk;
  }

  private async load(): Promise<void> {
    const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
    if (!publishableKey) {
      this.setSnapshot({
        status: "disabled",
        isEnabled: false,
        isLoaded: true,
        userId: null,
        email: null,
        displayName: "Guest",
        avatarUrl: null,
      });
      return;
    }

    this.setSnapshot({
      status: "loading",
      isEnabled: true,
      isLoaded: false,
      userId: null,
      email: null,
      displayName: "Loading...",
      avatarUrl: null,
    });

    const clerk = new Clerk(publishableKey);
    await clerk.load();
    this.clerk = clerk;
    this.syncSnapshotFromClerk();
    this.unsubscribe = clerk.addListener(() => {
      this.syncSnapshotFromClerk();
    });
  }

  private syncSnapshotFromClerk(): void {
    const user = this.clerk?.user ?? null;
    const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;
    const displayName = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.username || email || "Guest";

    this.setSnapshot({
      status: user ? "signed_in" : "signed_out",
      isEnabled: true,
      isLoaded: true,
      userId: user?.id ?? null,
      email,
      displayName,
      avatarUrl: user?.imageUrl ?? null,
    });
  }

  private setSnapshot(snapshot: AuthSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      void listener(snapshot);
    }
  }
}

const authService = new AuthService();

export function getAuthService(): AuthService {
  return authService;
}
