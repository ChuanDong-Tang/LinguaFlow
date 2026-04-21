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
  const status = String(row?.status ?? "").toLowerCase();
  const planCode = String(row?.plan_code ?? "").trim();

  return {
    planCode,
    active: status === "active" && isFutureDate(row?.end_at),
    source: row?.source || "manual",
    startsAt: row?.start_at ?? null,
    endsAt: row?.end_at ?? null,
  };
}

export function createAnonymousViewerAccess() {
  return {
    profile: null,
    entitlements: [],
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

  const { data: entitlementRow, error: entitlementError } = await supabase
    .from("entitlements")
    .select("*")
    .eq("user_id", appUser.id)
    .maybeSingle();

  if (entitlementError) {
    throw new Error(`[entitlements] expected single row per user_id, but got conflict for user_id=${appUser.id}`);
  }

  const entitlement = entitlementRow ? mapEntitlement(entitlementRow) : null;
  const entitlements = entitlement ? [entitlement] : [];
  const profile = mapAppUser(appUser);
  const hasPro = entitlement?.active === true;

  return {
    profile,
    entitlements,
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

  const entitlementPayload = {
    user_id: appUser.id,
    plan_code: planCode,
    status: "active",
    source,
    start_at: now.toISOString(),
    end_at: endsAt.toISOString(),
    updated_at: now.toISOString(),
  };

  const { error: entitlementError } = await supabase
    .from("entitlements")
    .upsert(entitlementPayload, { onConflict: "user_id" });

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
