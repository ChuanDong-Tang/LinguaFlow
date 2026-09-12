import {
  ApiError,
  clearStoredSession,
  completeAvatarUpload,
  createAvatarUpload,
  getStoredSession,
  getBindings,
  getProfile,
  getEntitlement,
  getUsageV2,
  loginWithPasscode,
  loginWithPassword,
  logout,
  removeProfileAvatar,
  sendPasscode,
  updateProfileNickname,
} from "./auth-client.js";

const loginView = document.getElementById("login-view");
const accountView = document.getElementById("account-view");
const accountIntro = document.getElementById("account-intro");
const loginForm = document.getElementById("login-form");
const statusBox = document.getElementById("login-status");
const submitButton = document.getElementById("login-submit");
const sendButton = document.getElementById("send-code");
const passcodeFields = document.getElementById("passcode-fields");
const passwordFields = document.getElementById("password-fields");
const profileDialog = document.getElementById("profile-edit-dialog");
const profileForm = document.getElementById("profile-edit-form");
const profileStatus = document.getElementById("profile-edit-status");
const profileAvatarFile = document.getElementById("profile-avatar-file");
let method = "passcode";
let channel = "email";
let countdownTimer = null;
let currentProfile = null;
let currentBindings = null;
let pendingAvatar = null;
let removeAvatarRequested = false;
let avatarPreviewUrl = null;

document.querySelectorAll("[data-login-method]").forEach((button) => {
  button.addEventListener("click", () => {
    method = button.dataset.loginMethod;
    setActiveButtons("[data-login-method]", button);
    passcodeFields.hidden = method !== "passcode";
    passwordFields.hidden = method !== "password";
    submitButton.textContent = method === "passcode" ? "继续" : "登录";
    setStatus("");
  });
});

document.querySelectorAll("[data-login-channel]").forEach((button) => {
  button.addEventListener("click", () => {
    channel = button.dataset.loginChannel;
    setActiveButtons("[data-login-channel]", button);
    document.getElementById("email-field").hidden = channel !== "email";
    document.getElementById("phone-field").hidden = channel !== "phone";
    setStatus("");
  });
});

sendButton.addEventListener("click", async () => {
  if (!requireAgreement()) return;
  try {
    sendButton.disabled = true;
    setStatus("正在发送验证码……", "pending");
    await sendPasscode(readPasscodeCredential());
    setStatus("验证码已发送，请查看短信或邮箱。", "success");
    startCountdown(60);
  } catch (error) {
    sendButton.disabled = false;
    setStatus(messageFor(error, "验证码发送失败，请稍后再试"), "error");
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!requireAgreement()) return;
  try {
    submitButton.disabled = true;
    setStatus("正在登录……", "pending");
    if (method === "password") {
      const account = document.getElementById("password-account").value.trim();
      const password = document.getElementById("password").value;
      if (!account) throw new Error("请输入手机号或邮箱");
      if (!password) throw new Error("请输入密码");
      await loginWithPassword({ account, password });
    } else {
      const passCode = document.getElementById("passcode").value.trim();
      if (!/^\d{4,8}$/.test(passCode)) throw new Error("请输入正确的验证码");
      await loginWithPasscode({ ...readPasscodeCredential(), passCode });
    }
    await renderAccount();
  } catch (error) {
    setStatus(messageFor(error, "登录失败，请稍后重试"), "error");
  } finally {
    submitButton.disabled = false;
  }
});

document.getElementById("logout-button").addEventListener("click", async () => {
  const button = document.getElementById("logout-button");
  button.disabled = true;
  await logout();
  button.disabled = false;
  showLogin();
});

document.getElementById("edit-profile-button").addEventListener("click", openProfileEditor);
document.getElementById("profile-edit-close").addEventListener("click", closeProfileEditor);
document.getElementById("profile-edit-cancel").addEventListener("click", closeProfileEditor);
document.getElementById("profile-avatar-remove").addEventListener("click", () => {
  pendingAvatar = null;
  removeAvatarRequested = true;
  clearAvatarPreviewUrl();
  renderAvatar(document.getElementById("profile-edit-avatar"), { ...currentProfile, avatar: null });
  document.getElementById("profile-avatar-remove").hidden = true;
});

profileAvatarFile.addEventListener("change", async () => {
  const file = profileAvatarFile.files?.[0];
  if (!file) return;
  try {
    setProfileStatus("正在处理头像……", "pending");
    pendingAvatar = await prepareAvatar(file);
    removeAvatarRequested = false;
    clearAvatarPreviewUrl();
    avatarPreviewUrl = URL.createObjectURL(pendingAvatar.blob);
    const preview = document.getElementById("profile-edit-avatar");
    preview.textContent = "";
    preview.style.backgroundImage = `url("${avatarPreviewUrl}")`;
    document.getElementById("profile-avatar-remove").hidden = false;
    setProfileStatus("");
  } catch (error) {
    pendingAvatar = null;
    profileAvatarFile.value = "";
    setProfileStatus(error instanceof Error ? error.message : "无法读取这张图片", "error");
  }
});

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentProfile) return;
  const nickname = document.getElementById("profile-nickname").value.trim();
  const saveButton = document.getElementById("profile-edit-save");
  if (!nickname) return setProfileStatus("请输入用户名", "error");
  try {
    saveButton.disabled = true;
    setProfileStatus("正在保存……", "pending");
    let profile = currentProfile;
    if (nickname !== profile.nickname) profile = await updateProfileNickname(nickname);
    if (pendingAvatar) profile = await uploadAvatar(pendingAvatar);
    else if (removeAvatarRequested && profile.avatar) profile = await removeProfileAvatar();
    currentProfile = profile;
    applyProfile(profile, currentBindings);
    closeProfileEditor();
  } catch (error) {
    setProfileStatus(messageFor(error, "资料保存失败，请稍后再试"), "error");
  } finally {
    saveButton.disabled = false;
  }
});

profileDialog.addEventListener("click", (event) => {
  if (event.target === profileDialog) closeProfileEditor();
});

function setActiveButtons(selector, activeButton) {
  document.querySelectorAll(selector).forEach((button) => {
    const active = button === activeButton;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function readPasscodeCredential() {
  if (channel === "phone") {
    const phone = document.getElementById("phone").value.replace(/\D/g, "");
    if (!/^1\d{10}$/.test(phone)) throw new Error("请输入正确的中国大陆手机号");
    return { channel: "phone", phone, phoneCountryCode: "+86" };
  }
  const email = document.getElementById("email").value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("请输入正确的邮箱地址");
  return { channel: "email", email };
}

function requireAgreement() {
  if (document.getElementById("agreement").checked) return true;
  setStatus("请先阅读并同意用户协议与隐私政策", "error");
  return false;
}

function startCountdown(seconds) {
  clearInterval(countdownTimer);
  let remaining = seconds;
  sendButton.disabled = true;
  sendButton.textContent = `${remaining} 秒后重发`;
  countdownTimer = setInterval(() => {
    remaining -= 1;
    sendButton.textContent = remaining > 0 ? `${remaining} 秒后重发` : "获取验证码";
    if (remaining <= 0) {
      clearInterval(countdownTimer);
      sendButton.disabled = false;
    }
  }, 1000);
}

function setStatus(message, type = "") {
  statusBox.textContent = message;
  statusBox.className = `form-status${type ? ` ${type}` : ""}`;
  statusBox.hidden = !message;
}

function messageFor(error, fallback) {
  if (!(error instanceof ApiError)) return error instanceof Error ? error.message : fallback;
  const messages = {
    PASSCODE_INVALID: "验证码错误或已过期",
    PASSCODE_SEND_FAILED: "验证码发送失败，请稍后再试",
    PASSWORD_INVALID: "账号或密码不正确",
    ACCOUNT_DISABLED: "该账号已被停用",
    ACCOUNT_PENDING_DELETE: "该账号正在注销中",
    PROFILE_NICKNAME_INVALID: "用户名格式不正确，请换一个试试",
    PROFILE_NICKNAME_BLOCKED: "这个用户名暂时无法使用，请换一个试试",
    PROFILE_MODERATION_UNAVAILABLE: "暂时无法保存用户名，请稍后再试",
    AVATAR_VALIDATION_FAILED: "头像格式或大小不符合要求",
    AVATAR_MODERATION_REJECTED: "这张头像暂时无法使用，请换一张试试",
    AVATAR_MODERATION_UNAVAILABLE: "暂时无法保存头像，请稍后再试",
    RATE_LIMITED: "操作太频繁，请稍后再试",
    NETWORK_ERROR: "无法连接服务器，请检查网络后重试",
  };
  return messages[error.code] ?? fallback;
}

function showLogin(message = "") {
  currentProfile = null;
  currentBindings = null;
  accountIntro.hidden = false;
  loginView.hidden = false;
  accountView.hidden = true;
  setStatus(message, message ? "error" : "");
}

function tierLabel(tier) {
  if (tier === "pro") return "Pro 用户";
  if (tier === "plus") return "Plus 用户";
  return "普通用户";
}

function formatExpiry(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

function formatPoints(value) {
  return Number.isFinite(value) ? new Intl.NumberFormat("zh-CN").format(Math.max(0, value)) : "—";
}

function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes >= 1024 ** 3) return `${formatDecimal(bytes / 1024 ** 3)} GB`;
  if (bytes >= 1024 ** 2) return `${formatDecimal(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${formatDecimal(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

function formatDecimal(value) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value);
}

async function renderAccount() {
  if (!getStoredSession()) return showLogin();
  accountIntro.hidden = true;
  loginView.hidden = true;
  accountView.hidden = false;
  accountView.classList.add("loading");
  document.getElementById("account-name").textContent = "正在读取账号……";
  document.getElementById("account-id").textContent = "";
  document.getElementById("edit-profile-button").disabled = true;
  document.getElementById("app-tier").textContent = "正在读取……";
  document.getElementById("app-expiry").textContent = "读取中";
  document.getElementById("points-remaining").textContent = "读取中";
  document.getElementById("images-remaining").textContent = "读取中";
  try {
    const [profileResult, entitlementResult, bindingsResult, usageResult] = await Promise.allSettled([
      getProfile(),
      getEntitlement(),
      getBindings(),
      getUsageV2(),
    ]);
    const authFailure = [profileResult, entitlementResult, bindingsResult, usageResult]
      .find((result) => result.status === "rejected" && isTerminalAuthError(result.reason));
    if (authFailure?.status === "rejected") {
      clearStoredSession();
      return showLogin(messageFor(authFailure.reason, "登录已失效，请重新登录"));
    }

    if (profileResult.status === "fulfilled") {
      currentProfile = profileResult.value;
      currentBindings = bindingsResult.status === "fulfilled" ? bindingsResult.value : null;
      applyProfile(currentProfile, currentBindings);
      if (bindingsResult.status === "rejected") {
        document.getElementById("account-id").textContent = "账号绑定信息暂时无法读取";
      }
      document.getElementById("edit-profile-button").disabled = false;
    } else {
      currentProfile = null;
      currentBindings = null;
      document.getElementById("account-name").textContent = "账号资料暂时无法读取";
      document.getElementById("account-id").textContent = messageFor(profileResult.reason, "请稍后刷新重试");
    }

    if (entitlementResult.status === "fulfilled") {
      const entitlement = entitlementResult.value;
      const tier = entitlement.tier ?? "free";
      document.getElementById("app-tier").textContent = tierLabel(tier);
      document.getElementById("app-tier-card").dataset.tier = tier;
      document.getElementById("app-expiry").textContent = tier === "free" ? "—" : formatExpiry(entitlement.expiresAt);
    } else {
      document.getElementById("app-tier").textContent = "暂时无法读取";
      document.getElementById("app-expiry").textContent = "—";
    }

    if (usageResult.status === "fulfilled") {
      document.getElementById("points-remaining").textContent = formatPoints(usageResult.value.token?.remaining);
      document.getElementById("images-remaining").textContent = formatBytes(
        usageResult.value.images?.remainingBytes ?? usageResult.value.images?.remainingUploadBytes,
      );
    } else {
      document.getElementById("points-remaining").textContent = "暂时无法读取";
      document.getElementById("images-remaining").textContent = "暂时无法读取";
    }
  } catch (error) {
    document.getElementById("account-name").textContent = "账号信息暂时无法读取";
    document.getElementById("account-id").textContent = messageFor(error, "请稍后刷新重试");
  } finally {
    accountView.classList.remove("loading");
  }
}

function isTerminalAuthError(error) {
  return error instanceof ApiError && (
    error.status === 401
    || error.code === "ACCOUNT_DISABLED"
    || error.code === "ACCOUNT_PENDING_DELETE"
  );
}

function applyProfile(profile, bindings) {
  document.getElementById("account-name").textContent = profile.nickname || "OIO 用户";
  document.getElementById("account-id").textContent = accountDescription(profile, bindings);
  renderAvatar(document.getElementById("account-avatar"), profile);
}

function accountDescription(profile, bindings) {
  const preferred = bindings?.registrationMethod === "phone" ? bindings.phone : bindings?.email;
  const fallback = bindings?.phone?.bound ? bindings.phone : bindings?.email;
  const binding = preferred?.maskedValue ? preferred : fallback;
  const kind = binding === bindings?.phone ? "手机号" : "邮箱";
  const account = binding?.maskedValue ? `${kind} · ${binding.maskedValue}` : "OIO 统一账号";
  return profile.nicknameSource === "default_generated" ? `临时用户名 · ${account}` : account;
}

function renderAvatar(element, profile, preferFullSize = false) {
  const avatarUrl = preferFullSize ? profile?.avatar?.url : profile?.avatar?.thumbnailUrl;
  element.style.backgroundImage = avatarUrl ? `url("${avatarUrl}")` : "";
  element.textContent = avatarUrl ? "" : (profile?.nickname || "O").slice(0, 1).toUpperCase();
}

function openProfileEditor() {
  if (!currentProfile) return;
  pendingAvatar = null;
  removeAvatarRequested = false;
  profileAvatarFile.value = "";
  clearAvatarPreviewUrl();
  document.getElementById("profile-nickname").value = currentProfile.nickname || "";
  document.getElementById("profile-avatar-remove").hidden = !currentProfile.avatar;
  renderAvatar(document.getElementById("profile-edit-avatar"), currentProfile, true);
  setProfileStatus("");
  profileDialog.showModal();
  document.getElementById("profile-nickname").focus();
}

function closeProfileEditor() {
  clearAvatarPreviewUrl();
  if (profileDialog.open) profileDialog.close();
}

function clearAvatarPreviewUrl() {
  if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
  avatarPreviewUrl = null;
}

function setProfileStatus(message, type = "") {
  profileStatus.textContent = message;
  profileStatus.className = `form-status${type ? ` ${type}` : ""}`;
  profileStatus.hidden = !message;
}

async function uploadAvatar(avatar) {
  const upload = await createAvatarUpload({
    fileSize: avatar.blob.size,
    width: avatar.width,
    height: avatar.height,
  });
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: avatar.blob,
  });
  if (!response.ok) throw new Error(`头像上传失败（${response.status}）`);
  return completeAvatarUpload(upload.uploadId);
}

async function prepareAvatar(file) {
  if (!file.type.startsWith("image/")) throw new Error("请选择图片文件");
  const image = await loadImage(file);
  const edge = Math.min(image.naturalWidth, image.naturalHeight);
  if (!edge) throw new Error("无法读取这张图片");
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const sourceX = Math.floor((image.naturalWidth - edge) / 2);
  const sourceY = Math.floor((image.naturalHeight - edge) / 2);
  context.drawImage(image, sourceX, sourceY, edge, edge, 0, 0, size, size);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
  if (!blob) throw new Error("无法处理这张图片");
  if (blob.size > 5 * 1024 * 1024) throw new Error("头像不能超过 5 MB");
  return { blob, width: size, height: size };
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("无法读取这张图片")); };
    image.src = url;
  });
}

renderAccount();
