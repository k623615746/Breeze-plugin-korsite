/**
 * 站点定义与域名状态
 *
 * korsite.net 是一个「韩漫/影视站导航」发布页，列出 toonkor(툰코)、funbe(펀비)、
 * newtoki(뉴토끼) 等站的最新域名。这些站共用同一套 Gnuboard 系统（`data-site`
 * 标记区分），结构完全一致：搜索 /bbs/search.php、详情 /作品名、章节 /作品名_N화.html。
 *
 * 本模块只负责「站点清单 + 各站当前域名」的状态管理，零外部依赖，
 * 避免与 site.ts（域名发现）循环 import。
 */

import { authConfig } from "breeze-plugin-kit";

export type SiteDef = {
  /** 内部稳定 ID */
  id: string;
  /** 韩文名 */
  nameKo: string;
  /** 中文名 */
  nameZh: string;
  /** 内置默认域名（发布页不可达时的兜底） */
  defaultOrigin: string;
  /** 用于区分站点页面特征的 data-site 值 */
  dataSite: string;
  /** 是否默认启用（聚合搜索/排行时是否纳入） */
  enabled: boolean;
};

/**
 * 支持的漫画站清单。
 * 只收录「纯漫画」站；korsite 上的影视(무비코/코무비)、成人(코야동/딸타임/개조아/야동피드/오나니방)
 * 等一律不收录。블랙툰(blacktoon) 有 Cloudflare 强校验，Node/QuickJS fetch 过不了，暂不纳入。
 */
export const SITES: ReadonlyArray<SiteDef> = [
  {
    id: "toonkor",
    nameKo: "툰코",
    nameZh: "툰코",
    defaultOrigin: "https://toonkor6.org",
    dataSite: "toonkor",
    enabled: true,
  },
  {
    id: "funbe",
    nameKo: "펀비",
    nameZh: "펀비",
    defaultOrigin: "https://funbe683.com",
    dataSite: "funbe",
    enabled: true,
  },
  {
    id: "newtoki",
    nameKo: "뉴토끼",
    nameZh: "뉴토끼",
    defaultOrigin: "https://n3.newtoki.top",
    dataSite: "newtoki",
    // Cloudflare "Just a moment" 强校验，Node/QuickJS fetch 过不了，暂不启用
    enabled: false,
  },
];

export function getSiteById(id: string): SiteDef | undefined {
  return SITES.find((site) => site.id === id);
}

export function defaultSites(): SiteDef[] {
  return SITES.filter((site) => site.enabled);
}

/** 域名状态：每个站点独立记录当前 origin */
const origins = new Map<string, string>();
for (const site of SITES) {
  origins.set(site.id, site.defaultOrigin);
}

const ORIGIN_KEY_PREFIX = "site.origin.";

export function normalizeOrigin(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }
  let value = raw.trim();
  if (!value) {
    return "";
  }
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  try {
    const parsed = new URL(value);
    if (!parsed.hostname || !parsed.hostname.includes(".")) {
      return "";
    }
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "";
  }
}

export function getOrigin(siteId: string): string {
  const site = getSiteById(siteId);
  return origins.get(siteId) ?? site?.defaultOrigin ?? "";
}

export function setOrigin(siteId: string, raw: unknown): string {
  const normalized = normalizeOrigin(raw);
  if (normalized) {
    origins.set(siteId, normalized);
  }
  return getOrigin(siteId);
}

export function resetOrigin(siteId: string): string {
  const site = getSiteById(siteId);
  const fallback = site?.defaultOrigin ?? "";
  origins.set(siteId, fallback);
  return fallback;
}

export function originHost(siteId: string): string {
  try {
    return new URL(getOrigin(siteId)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** 判断 host 是否属于某站族群（历史域名都含站名关键词） */
export function isSiteHost(siteId: string, host: string): boolean {
  const value = String(host ?? "").toLowerCase();
  if (!value || value.endsWith("github.io")) {
    return false;
  }
  const site = getSiteById(siteId);
  if (!site) {
    return false;
  }
  const bare = site.defaultOrigin.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  // 提取默认域名的主干（去掉数字与二级变化，如 toonkor6.org → toonkor）
  const core = bare.replace(/^[a-z0-9]+\./i, "").replace(/\d+/g, "");
  const siteCore = site.id;
  // 只要 host 包含站点 ID 关键词即视为同族
  return value.includes(siteCore) || value.includes(core);
}

/** 页面特征：判定一份 HTML 是否真的是该站（而非停放页/劫持页） */
export function looksLikeSitePage(html: string, expectedDataSite: string): boolean {
  if (!html) {
    return false;
  }
  if (expectedDataSite && html.includes(`data-site="${expectedDataSite}"`)) {
    return true;
  }
  // 兜底：出现 Gnuboard 特征 + webtoon 内容
  return (
    (html.includes("/bbs/board.php") || html.includes("search.php")) &&
    (html.includes("웹툰") || html.includes("툰코") || html.includes("펀비") || html.includes("뉴토끼"))
  );
}

export function looksLikeParkedPage(html: string): boolean {
  if (!html) {
    return false;
  }
  const lower = html.toLowerCase();
  return (
    lower.includes("domain is for sale") ||
    lower.includes("buy this domain") ||
    lower.includes("parked domain") ||
    lower.includes("cloudflare") && lower.includes("just a moment") ||
    html.includes("域名出售") ||
    html.includes("域名已过期") ||
    html.includes("网站已关闭")
  );
}

/** 从持久化配置恢复某站域名 */
export async function loadPersistedOrigin(siteId: string): Promise<string> {
  try {
    const saved = await authConfig.load(`${ORIGIN_KEY_PREFIX}${siteId}`, "");
    const normalized = normalizeOrigin(saved);
    if (normalized) {
      return setOrigin(siteId, normalized);
    }
  } catch {
    // 读取失败沿用默认值
  }
  return getOrigin(siteId);
}

/** 持久化某站域名 */
export async function persistOrigin(siteId: string, origin: string): Promise<void> {
  try {
    await authConfig.save(`${ORIGIN_KEY_PREFIX}${siteId}`, origin);
  } catch {
    // 持久化失败不影响本次会话
  }
}
