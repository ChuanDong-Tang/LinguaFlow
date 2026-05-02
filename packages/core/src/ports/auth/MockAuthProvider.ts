import type { User } from "../../types/index.js";
import type { AuthLoginResult, AuthProvider} from "./AuthProvider.js";
import type { LoginCredential } from "../../contracts/auth.js";


// Mock 登录实现：现在先返回固定 token，后面可替换为真实登录
export class MockAuthProvider implements AuthProvider {
  async login(input: LoginCredential): Promise<AuthLoginResult> {
    const now = new Date().toISOString();

    const user: User = {
      id: "mock_user_001",
      phone: input.type === "phone_code" ? input.phone : null,
      email: input.type === "email_code" ? input.email : null,
      wechatOpenId: input.type === "wechat_code" ? "wx_openid_mock_001" : null,
      displayName: "Mock User",
      avatarUrl: null,
      createdAt: now,
      updatedAt: now
    };

    return {
      token: "token_mock_001",
      user,
      sessionFlags: {
        isPro: true,
      },
    };
  }
}
