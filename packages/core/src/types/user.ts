export type User = {
  id: string;
  phone: string | null;
  email: string | null;
  wechatOpenId: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role?: "user" | "admin";
  createdAt: string;
  updatedAt: string;
};
