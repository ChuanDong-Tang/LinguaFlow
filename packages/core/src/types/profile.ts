export type ProfileNicknameSource = "default_generated" | "user_custom";
export type RegistrationMethod = "phone" | "email";

export interface UserAvatarView {
  url: string;
  thumbnailUrl: string;
  urlExpiresAt: string | null;
}

export interface UserProfileView {
  userId: string;
  nickname: string;
  nicknameSource: ProfileNicknameSource;
  registrationMethod: RegistrationMethod;
  avatar: UserAvatarView | null;
  avatarKind: "default" | "custom";
}

export interface BindingItemView {
  bound: boolean;
  maskedValue: string | null;
  action: "none" | "bind" | "unsupported";
}

export interface UserBindingsView {
  registrationMethod: RegistrationMethod;
  phone: BindingItemView;
  email: BindingItemView;
}
