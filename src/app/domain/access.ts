export type SubscriptionStatus = "inactive" | "active" | "trialing" | "past_due" | "canceled";

export interface ViewerProfile {
  appUserId: string;
  clerkUserId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export interface ViewerEntitlement {
  code: string;
  active: boolean;
  source: string;
  expiresAt: string | null;
}

export interface ViewerSubscription {
  planCode: string;
  status: SubscriptionStatus;
  source: string;
  startsAt: string | null;
  endsAt: string | null;
}

export interface ViewerPermissions {
  canUseRewrite: boolean;
  canManageSubscriptions: boolean;
  canSyncHistory: boolean;
}

export interface ViewerAccess {
  profile: ViewerProfile | null;
  entitlements: ViewerEntitlement[];
  subscription: ViewerSubscription | null;
  permissions: ViewerPermissions;
}
