export interface ViewerProfile {
  appUserId: string;
  clerkUserId: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
}

export interface ViewerEntitlement {
  planCode: string;
  active: boolean;
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
  permissions: ViewerPermissions;
}
