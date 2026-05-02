export const messages = {
  "zh-CN": {
    "auth.login.wechat_button": "微信登录",
    "auth.login.agree_prefix": "我已阅读并同意",
    "auth.login.terms": "服务条款",
    "auth.login.and": "和",
    "auth.login.privacy": "隐私政策",
    "auth.login.failed": "登录失败"
  },
  en: {
    "auth.login.wechat_button": "Continue with WeChat",
    "auth.login.agree_prefix": "I have read and agree to the",
    "auth.login.terms": "Terms of Service",
    "auth.login.and": "and",
    "auth.login.privacy": "Privacy Policy",
    "auth.login.failed": "Login failed"
  }
} as const;

export type SupportedLanguage = keyof typeof messages;
export type TranslationKey = keyof (typeof messages)["zh-CN"];
