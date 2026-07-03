import { createHash } from "node:crypto";
import type { SystemEventLogRepository } from "@lf/core/ports/repository/SystemEventLogRepository.js";
import type { TencentTmsClient, TencentTmsModerationResult } from "./TencentTmsClient.js";

export type ContentSafetyStage = "input" | "output";
export type ContentSafetyCategory =
  | "political"
  | "child_safety"
  | "sexual"
  | "violence"
  | "religion_extremism"
  | "illegal"
  | "fraud"
  | "drugs"
  | "gambling";

export interface ContentSafetyViolation {
  category: ContentSafetyCategory;
  ruleId: string;
  severity: "block";
  matchedTerm?: string;
  vendor?: "tencent_tms";
  vendorRequestId?: string;
  vendorSuggestion?: string;
  vendorLabel?: string;
  vendorSubLabel?: string;
  vendorScore?: number;
  vendorKeywords?: string[];
}

export class ContentSafetyBlockedError extends Error {
  readonly code = "CONTENT_BLOCKED";
  readonly statusCode = 400;

  constructor(
    readonly stage: ContentSafetyStage,
    readonly violation: ContentSafetyViolation
  ) {
    super("This content cannot be sent.");
  }
}

export interface ContentSafetyServiceOptions {
  tencentTmsClient?: TencentTmsClient;
  tencentTmsEnabled?: boolean;
  tencentTmsBlockSuggestions?: string[];
  tencentTmsFailClosed?: boolean;
  tencentTmsReviewMode?: "suspect" | "all";
}

type ScanText = {
  raw: string;
  normalized: string;
  compact: string;
  loose: string;
};

type ComboRule = {
  category: ContentSafetyCategory;
  ruleId: string;
  left: string[];
  right: string[];
};

const POLITICAL_DIRECT_TERMS = [
  "习近平",
  "習近平",
  "xijinping",
  "xi jinping",
  "xjp",
  "毛泽东",
  "毛澤東",
  "maozedong",
  "mao zedong",
];

const POLITICAL_SHORT_ALIASES = ["xi"];

const POLITICAL_CONTEXT_TERMS = [
  "独裁",
  "獨裁",
  "dictator",
  "dictatorship",
  "democracy",
  "民主",
  "专制",
  "專制",
  "集权",
  "集權",
  "政权",
  "政權",
  "政党",
  "政黨",
  "主席",
  "总统",
  "總統",
  "leader",
  "president",
  "评价",
  "評價",
  "批判",
  "反对",
  "反對",
  "支持",
  "下台",
  "革命",
  "protest",
  "抗议",
  "抗議",
];

const CHILD_TERMS = ["儿童", "兒童", "小孩", "未成年", "幼女", "幼童", "child", "children", "minor", "underage", "kid"];
const SEXUAL_TERMS = ["色情", "裸聊", "性行为", "性行為", "强奸", "強姦", "rape", "porn", "sex", "nude", "naked"];
const VIOLENCE_TERMS = ["恐怖袭击", "恐怖襲擊", "爆炸物", "炸弹", "炸彈", "枪支", "槍支", "砍杀", "砍殺", "屠杀", "屠殺", "terrorist", "bomb", "massacre"];
const SELF_HARM_TERMS = ["自杀教程", "自殺教程", "suicide method", "how to suicide"];
const RELIGION_EXTREMISM_TERMS = ["圣战", "聖戰", "极端宗教", "極端宗教", "邪教", "jihad", "religious extremist"];
const ILLEGAL_TERMS = ["洗钱", "洗錢", "黑产", "黑產", "盗号", "盜號", "绕过风控", "繞過風控", "money laundering", "carding"];
const FRAUD_TERMS = ["诈骗话术", "詐騙話術", "杀猪盘", "殺豬盤", "钓鱼链接", "釣魚鏈接", "phishing kit", "scam script"];
const DRUG_TERMS = ["冰毒", "海洛因", "可卡因", "贩毒", "販毒", "meth", "heroin", "cocaine"];
const GAMBLING_TERMS = ["赌博", "賭博", "博彩", "赌盘", "賭盤", "casino", "betting"];
const DIRECT_VIOLENCE_TERMS = ["恐怖袭击", "恐怖襲擊", "爆炸物", "炸弹", "炸彈", "枪支", "槍支", "砍杀", "砍殺", "屠杀", "屠殺"];
const DIRECT_RELIGION_EXTREMISM_TERMS = ["圣战", "聖戰", "极端宗教", "極端宗教", "邪教", "religious extremist"];
const DIRECT_GAMBLING_TERMS = ["赌盘", "賭盤"];
const REMOTE_SEXUAL_TERMS = [...SEXUAL_TERMS, "低俗", "成人内容", "成人內容", "约炮", "約炮", "smut"];
const REMOTE_VIOLENCE_TERMS = [...VIOLENCE_TERMS, ...SELF_HARM_TERMS, "暴力", "杀人", "殺人", "自杀", "自殺", "血腥", "武器", "weapon", "kill"];
const REMOTE_RELIGION_TERMS = [...RELIGION_EXTREMISM_TERMS, "宗教", "religion", "cult"];
const REMOTE_ILLEGAL_TERMS = [...ILLEGAL_TERMS, "违法", "違法", "犯罪", "黑灰产", "黑灰產", "套现", "套現"];
const REMOTE_FRAUD_TERMS = [...FRAUD_TERMS, "诈骗", "詐騙", "骗局", "騙局", "钓鱼", "釣魚", "scam", "phishing"];
const REMOTE_DRUG_TERMS = [...DRUG_TERMS, "毒品", "drug"];
const REMOTE_GAMBLING_TERMS = [...GAMBLING_TERMS, "下注", "开盘", "開盤", "赌", "賭"];

const REMOTE_REVIEW_RULES: Array<{
  category: ContentSafetyCategory;
  ruleId: string;
  terms: string[];
}> = [
  { category: "political", ruleId: "remote_review_political_signal", terms: [...POLITICAL_SHORT_ALIASES, ...POLITICAL_CONTEXT_TERMS] },
  { category: "child_safety", ruleId: "remote_review_child_signal", terms: CHILD_TERMS },
  { category: "sexual", ruleId: "remote_review_sexual_signal", terms: REMOTE_SEXUAL_TERMS },
  { category: "violence", ruleId: "remote_review_violence_signal", terms: REMOTE_VIOLENCE_TERMS },
  { category: "religion_extremism", ruleId: "remote_review_religion_signal", terms: REMOTE_RELIGION_TERMS },
  { category: "illegal", ruleId: "remote_review_illegal_signal", terms: REMOTE_ILLEGAL_TERMS },
  { category: "fraud", ruleId: "remote_review_fraud_signal", terms: REMOTE_FRAUD_TERMS },
  { category: "drugs", ruleId: "remote_review_drugs_signal", terms: REMOTE_DRUG_TERMS },
  { category: "gambling", ruleId: "remote_review_gambling_signal", terms: REMOTE_GAMBLING_TERMS },
];

const DIRECT_RULES: Array<{
  category: ContentSafetyCategory;
  ruleId: string;
  terms: string[];
}> = [
  { category: "political", ruleId: "political_direct_entity", terms: POLITICAL_DIRECT_TERMS },
  { category: "violence", ruleId: "violence_direct_high_risk", terms: DIRECT_VIOLENCE_TERMS },
  { category: "violence", ruleId: "self_harm_direct_instruction", terms: SELF_HARM_TERMS },
  { category: "religion_extremism", ruleId: "religion_extremism_direct", terms: DIRECT_RELIGION_EXTREMISM_TERMS },
  { category: "illegal", ruleId: "illegal_direct", terms: ILLEGAL_TERMS },
  { category: "fraud", ruleId: "fraud_direct", terms: FRAUD_TERMS },
  { category: "drugs", ruleId: "drugs_direct", terms: DRUG_TERMS },
  { category: "gambling", ruleId: "gambling_direct", terms: DIRECT_GAMBLING_TERMS },
];

const COMBO_RULES: ComboRule[] = [
  {
    category: "political",
    ruleId: "political_short_alias_context",
    left: POLITICAL_SHORT_ALIASES,
    right: POLITICAL_CONTEXT_TERMS,
  },
  {
    category: "child_safety",
    ruleId: "child_sexual_context",
    left: CHILD_TERMS,
    right: SEXUAL_TERMS,
  },
];

export class ContentSafetyService {
  private readonly tencentTmsBlockSuggestions: Set<string>;

  constructor(
    private readonly systemEventLogRepository?: SystemEventLogRepository,
    private readonly options: ContentSafetyServiceOptions = {}
  ) {
    this.tencentTmsBlockSuggestions = new Set(options.tencentTmsBlockSuggestions ?? ["Block", "Review"]);
  }

  scan(text: string): ContentSafetyViolation | null {
    const scanText = buildScanText(text);

    for (const rule of DIRECT_RULES) {
      const matchedTerm = findMatchedTerm(scanText, rule.terms);
      if (matchedTerm) {
        return { category: rule.category, ruleId: rule.ruleId, severity: "block", matchedTerm };
      }
    }

    for (const rule of COMBO_RULES) {
      const leftTerm = findMatchedTerm(scanText, rule.left);
      if (!leftTerm) continue;
      const rightTerm = findMatchedTerm(scanText, rule.right);
      if (rightTerm) {
        return {
          category: rule.category,
          ruleId: rule.ruleId,
          severity: "block",
          matchedTerm: `${leftTerm}+${rightTerm}`,
        };
      }
    }

    return null;
  }

  assertAllowed(text: string, stage: ContentSafetyStage): void {
    const violation = this.scan(text);
    if (violation) throw new ContentSafetyBlockedError(stage, violation);
  }

  async assertAllowedRemote(input: {
    text: string;
    stage: ContentSafetyStage;
    requestId: string;
    userId: string | null;
    conversationId?: string | null;
  }): Promise<void> {
    if (!this.options.tencentTmsEnabled || !this.options.tencentTmsClient) return;
    const reviewSignal = this.scanRemoteReviewSignal(input.text);
    if ((this.options.tencentTmsReviewMode ?? "suspect") !== "all" && !reviewSignal) return;

    let result: TencentTmsModerationResult;
    try {
      result = await this.options.tencentTmsClient.moderateText({
        text: input.text,
        dataId: input.requestId,
        userId: input.userId,
        sessionId: input.conversationId,
      });
    } catch (error) {
      await this.logRemoteFailure(input, error);
      if (this.options.tencentTmsFailClosed) {
        throw new ContentSafetyBlockedError(input.stage, {
          category: "illegal",
          ruleId: "tencent_tms_unavailable_fail_closed",
          severity: "block",
          vendor: "tencent_tms",
          vendorRequestId: typeof error === "object" && error !== null && "requestId" in error
            ? String((error as { requestId?: unknown }).requestId ?? "")
            : undefined,
        });
      }
      return;
    }

    if (!this.tencentTmsBlockSuggestions.has(result.suggestion)) return;

    throw new ContentSafetyBlockedError(input.stage, {
      category: mapTencentLabelToCategory(result.label),
      ruleId: "tencent_tms_suggestion",
      severity: "block",
      matchedTerm: reviewSignal?.matchedTerm,
      vendor: "tencent_tms",
      vendorRequestId: result.requestId,
      vendorSuggestion: result.suggestion,
      vendorLabel: result.label,
      vendorSubLabel: result.subLabel,
      vendorScore: result.score,
      vendorKeywords: result.keywords,
    });
  }

  scanRemoteReviewSignal(text: string): { category: ContentSafetyCategory; ruleId: string; matchedTerm: string } | null {
    const scanText = buildScanText(text);
    for (const rule of REMOTE_REVIEW_RULES) {
      const matchedTerm = findMatchedTerm(scanText, rule.terms);
      if (matchedTerm) {
        return { category: rule.category, ruleId: rule.ruleId, matchedTerm };
      }
    }
    return null;
  }

  async logBlocked(input: {
    requestId: string;
    userId: string | null;
    stage: ContentSafetyStage;
    path: string;
    text: string;
    contactId?: string | null;
    conversationId?: string | null;
    userMessageId?: string | null;
    violation: ContentSafetyViolation;
  }): Promise<void> {
    try {
      await this.systemEventLogRepository?.create({
        requestId: input.requestId,
        userId: input.userId,
        module: "content_safety",
        event: "content_safety.blocked",
        level: "warn",
        status: "failed",
        errorCode: "CONTENT_BLOCKED",
        errorMessage: `${input.violation.category}:${input.violation.ruleId}:${input.stage}`,
        metadata: {
          path: input.path,
          stage: input.stage,
          category: input.violation.category,
          ruleId: input.violation.ruleId,
          severity: input.violation.severity,
          vendor: input.violation.vendor ?? null,
          vendorRequestId: input.violation.vendorRequestId ?? null,
          vendorSuggestion: input.violation.vendorSuggestion ?? null,
          vendorLabel: input.violation.vendorLabel ?? null,
          vendorSubLabel: input.violation.vendorSubLabel ?? null,
          vendorScore: input.violation.vendorScore ?? null,
          vendorKeywords: input.violation.vendorKeywords ?? [],
          matchedTerm: input.violation.matchedTerm ?? null,
          textHash: hashText(input.text),
          textLength: input.text.length,
          contactId: input.contactId ?? null,
          conversationId: input.conversationId ?? null,
          userMessageId: input.userMessageId ?? null,
        },
      });
    } catch {
      // Content safety logging must never hide the blocking decision.
    }
  }

  private async logRemoteFailure(
    input: {
      requestId: string;
      userId: string | null;
      stage: ContentSafetyStage;
      text: string;
    },
    error: unknown
  ): Promise<void> {
    try {
      await this.systemEventLogRepository?.create({
        requestId: input.requestId,
        userId: input.userId,
        module: "content_safety",
        event: "content_safety.tencent_tms_failed",
        level: this.options.tencentTmsFailClosed ? "error" : "warn",
        status: this.options.tencentTmsFailClosed ? "failed" : "ignored",
        errorCode: typeof error === "object" && error !== null && "code" in error
          ? String((error as { code?: unknown }).code)
          : "TENCENT_TMS_ERROR",
        errorMessage: error instanceof Error ? error.message : String(error ?? "unknown"),
        metadata: {
          vendor: "tencent_tms",
          stage: input.stage,
          textHash: hashText(input.text),
          textLength: input.text.length,
          failClosed: Boolean(this.options.tencentTmsFailClosed),
        },
      });
    } catch {
      // Remote moderation failures should not hide the original moderation path.
    }
  }
}

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function buildScanText(raw: string): ScanText {
  const normalized = raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .replace(/[|!！1]/g, (ch) => (ch === "1" ? "i" : ""))
    .replace(/[0]/g, "o")
    .replace(/[5$]/g, "s")
    .replace(/[4@]/g, "a");
  const loose = normalized.replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, " ").trim();
  const compact = loose.replace(/\s+/g, "");
  return { raw, normalized, compact, loose: ` ${loose} ` };
}

function findMatchedTerm(text: ScanText, terms: string[]): string | null {
  return terms.find((term) => includesTerm(text, term)) ?? null;
}

function includesTerm(text: ScanText, term: string): boolean {
  const normalizedTerm = buildScanText(term);
  if (!normalizedTerm.compact) return false;
  if (/^[a-z0-9]+$/.test(normalizedTerm.compact)) {
    const normalizedText = normalizedTerm.compact === "xi" ? maskXianPlaceName(text.normalized) : text.normalized;
    return buildAsciiTermRegex(normalizedTerm.compact).test(normalizedText);
  }
  return text.compact.includes(normalizedTerm.compact);
}

function maskXianPlaceName(text: string): string {
  return text.replace(/(^|[^a-z0-9])xi['’ʼ`-]?an([^a-z0-9]|$)/g, "$1xian$2");
}

function buildAsciiTermRegex(term: string): RegExp {
  const chars = Array.from(term).map(escapeRegExp).join("[^a-z0-9]*");
  return new RegExp(`(^|[^a-z0-9])${chars}([^a-z0-9]|$)`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mapTencentLabelToCategory(label: string): ContentSafetyCategory {
  switch (label) {
    case "Porn":
      return "sexual";
    case "Terror":
      return "violence";
    case "Illegal":
      return "illegal";
    case "Ad":
      return "fraud";
    case "Polity":
      return "political";
    default:
      return "illegal";
  }
}
