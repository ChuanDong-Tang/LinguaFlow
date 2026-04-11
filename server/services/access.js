import { getClerkUser } from "../core/auth.js";
import { getAppConfig } from "../core/appConfig.js";
import { getSupabaseAdmin } from "../infrastructure/supabase.js";

function buildDisplayName(user) {
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
  return name || user?.username || user?.primaryEmailAddress?.emailAddress || "Member";
}

function mapPrimaryEmail(user) {
  return user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;
}

function isFutureDate(value) {
  if (!value) return true;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() > Date.now();
}

function isAdminUser(user) {
  const config = getAppConfig();
  const primaryEmail = mapPrimaryEmail(user)?.toLowerCase() ?? "";
  return config.adminClerkUserIds.includes(user?.id ?? "")
    || (!!primaryEmail && config.adminEmails.includes(primaryEmail));
}

function mapAppUser(userRow) {
  return {
    appUserId: userRow.id,
    clerkUserId: userRow.clerk_user_id,
    email: userRow.email,
    displayName: userRow.display_name || "Member",
    avatarUrl: userRow.avatar_url,
    isAdmin: !!userRow.is_admin,
  };
}

function mapEntitlement(row) {
  return {
    code: row.code,
    active: row.status === "active" && isFutureDate(row.expires_at),
    source: row.source || "manual",
    expiresAt: row.expires_at,
  };
}

function mapSubscription(row) {
  if (!row) return null;
  const active = row.status === "active" && isFutureDate(row.ends_at);
  return {
    planCode: row.plan_code,
    status: active ? row.status : "inactive",
    source: row.source || "manual",
    startsAt: row.started_at,
    endsAt: row.ends_at,
  };
}

export function createAnonymousViewerAccess() {
  return {
    profile: null,
    entitlements: [],
    subscription: null,
    permissions: {
      canUseRewrite: true,
      canManageSubscriptions: false,
      canSyncHistory: false,
    },
  };
}

export async function ensureAppUser(clerkUserId) {
  const supabase = getSupabaseAdmin();
  const clerkUser = await getClerkUser(clerkUserId);
  const payload = {
    clerk_user_id: clerkUser.id,
    email: mapPrimaryEmail(clerkUser),
    display_name: buildDisplayName(clerkUser),
    avatar_url: clerkUser.imageUrl ?? null,
    is_admin: isAdminUser(clerkUser),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("app_users")
    .upsert(payload, { onConflict: "clerk_user_id" })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

export async function getViewerAccessByClerkUserId(clerkUserId) {
  const supabase = getSupabaseAdmin();
  const appUser = await ensureAppUser(clerkUserId);

  const [{ data: entitlementRows, error: entitlementError }, { data: subscriptionRow, error: subscriptionError }] = await Promise.all([
    supabase.from("entitlements").select("*").eq("user_id", appUser.id).order("created_at", { ascending: false }),
    supabase.from("subscriptions").select("*").eq("user_id", appUser.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (entitlementError) {
    throw entitlementError;
  }

  if (subscriptionError) {
    throw subscriptionError;
  }

  const entitlements = (entitlementRows ?? []).map(mapEntitlement);
  const subscription = mapSubscription(subscriptionRow);
  const profile = mapAppUser(appUser);
  const hasPro = entitlements.some((item) => item.active && item.code === "pro_access");

  return {
    profile,
    entitlements,
    subscription,
    permissions: {
      canUseRewrite: true,
      canManageSubscriptions: profile.isAdmin,
      canSyncHistory: hasPro,
    },
  };
}

async function createAdminAuditLog({ actorUserId, targetUserId, action, metadata }) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("admin_audit_logs").insert({
    actor_user_id: actorUserId,
    target_user_id: targetUserId,
    action,
    metadata: metadata ?? {},
  });

  if (error) {
    throw error;
  }
}

export async function activateManualSubscription({ clerkUserId, actorClerkUserId = null, planCode, months = 1, source = "manual" }) {
  const supabase = getSupabaseAdmin();
  const appUser = await ensureAppUser(clerkUserId);
  const actorUser = actorClerkUserId ? await ensureAppUser(actorClerkUserId) : null;
  const now = new Date();
  const durationDays = Math.max(1, months) * 30;
  const endsAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const subscriptionPayload = {
    user_id: appUser.id,
    plan_code: planCode,
    status: "active",
    source,
    started_at: now.toISOString(),
    ends_at: endsAt.toISOString(),
    updated_at: now.toISOString(),
  };

  const entitlementPayload = {
    user_id: appUser.id,
    code: "pro_access",
    status: "active",
    source,
    expires_at: endsAt.toISOString(),
    updated_at: now.toISOString(),
  };

  const [{ error: subscriptionError }, { error: entitlementError }] = await Promise.all([
    supabase.from("subscriptions").insert(subscriptionPayload),
    supabase.from("entitlements").upsert(entitlementPayload, { onConflict: "user_id,code" }),
  ]);

  if (subscriptionError) {
    throw subscriptionError;
  }

  if (entitlementError) {
    throw entitlementError;
  }

  if (actorUser) {
    await createAdminAuditLog({
      actorUserId: actorUser.id,
      targetUserId: appUser.id,
      action: "manual_subscription_activated",
      metadata: {
        clerkUserId,
        planCode,
        months,
        durationDays,
        source,
        endsAt: endsAt.toISOString(),
      },
    });
  }

  return getViewerAccessByClerkUserId(clerkUserId);
}
