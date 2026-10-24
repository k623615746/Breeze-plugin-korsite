/**
 * 中文 → 韩文翻译（免费 MyMemory 翻译 API）
 *
 * 韩漫站的搜索只能匹配韩文关键词，用户用中文搜时需要先把中文转成韩文。
 * MyMemory（https://mymemory.translated.net）提供免密钥的机器翻译接口，
 * 支持 zh-CN → ko-KR。
 *
 * 兜底策略：
 *  1. 若输入本就含韩文，直接用原文搜（无需翻译）。
 *  2. 否则走 MyMemory 翻译。
 *  3. 翻译失败时，保留原文（可能命中站内的英文标题）。
 */

import { USER_AGENT, containsHangul } from "./common";

const TRANSLATE_URL = "https://api.mymemory.translated.net/get";

/** 可选：用户自配的 MyMemory 私有邮箱，可解锁更高配额（默认匿名也可用） */
let email = "";

export function setTranslateEmail(value: string): void {
  email = value.trim();
}

export function getTranslateEmail(): string {
  return email;
}

export type TranslateResult = {
  /** 最终用于搜索的关键词（可能是韩文，也可能是原文） */
  query: string;
  /** 是否发生了翻译（false 表示原文即韩文，或翻译失败回退原文） */
  translated: boolean;
  /** 韩文结果（翻译成功时有效） */
  korean: string;
  /** 提示信息 */
  note: string;
};

/** 把中文关键词转成韩文（用于搜索） */
export async function translateToKorean(keyword: string): Promise<TranslateResult> {
  const text = keyword.trim();
  if (!text) {
    return { query: "", translated: false, korean: "", note: "" };
  }

  // 已含韩文 → 直接用原文
  if (containsHangul(text)) {
    return {
      query: text,
      translated: false,
      korean: text,
      note: "关键词已含韩文，直接搜索",
    };
  }

  const params = new URLSearchParams({
    q: text,
    langpair: "zh-CN|ko",
  });
  if (email) {
    params.set("de", email);
  }

  try {
    const res = await fetch(`${TRANSLATE_URL}?${params.toString()}`, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      responseStatus?: number | string;
      responseData?: { translatedText?: string };
    };
    const translated = String(data?.responseData?.translatedText ?? "").trim();
    if (!translated) {
      throw new Error("翻译结果为空");
    }
    return {
      query: translated,
      translated: true,
      korean: translated,
      note: `已翻译为韩文「${translated}」`,
    };
  } catch (error) {
    console.log("[korsite] 翻译失败，回退原文:", error instanceof Error ? error.message : error);
    return {
      query: text,
      translated: false,
      korean: "",
      note: "翻译服务不可用，改用原文搜索（可能命中英文标题）",
    };
  }
}
