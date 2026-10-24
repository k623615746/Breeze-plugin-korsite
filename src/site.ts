/**
 * 从 korsite.net 发布页发现各站最新域名
 *
 * korsite.net 首页列出各站的最新地址（툰코/블랙툰/뉴토끼/펀비 ...）。
 * 这些站的域名经常更换（toonkor6.org、funbe683.com 等带数字后缀），
 * 域名失效时从这里拿到新地址，探测可用后切换。
 *
 * 本模块只用原生 fetch + BreezeHtml，不 import http.ts，避免循环依赖。
 */

import { USER_AGENT } from "./common";
import {
  SITES,
  defaultSites,
  getOrigin,
  looksLikeParkedPage,
  looksLikeSitePage,
  normalizeOrigin,
  persistOrigin,
  setOrigin,
  type SiteDef,
} from "./sites";

export const PUBLISHER_URL = "https://korsite.net/";

const PROBE_TIMEOUT_MS = 10000;

type Selection = {
  attr: (name: string) => string | undefined;
  text: () => string;
  each: (fn: (index: number, element: unknown) => void) => void;
};

type HtmlApi = ((selector: string) => Selection) & { load: (html: string) => HtmlApi };

function html(): HtmlApi {
  return (globalThis as unknown as { BreezeHtml: HtmlApi }).BreezeHtml;
}

const HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ko-KR,ko;q=0.9,zh-CN,zh;q=0.8,en;q=0.7",
};

/**
 * 从发布页 HTML 里，按站名关键词把链接归到对应站点。
 * 返回 Map<siteId, 候选域名列表>。
 */
export function collectSiteCandidates(publisherHtml: string): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const $ = html().load(publisherHtml);

  // 预建站名 → 关键词列表（韩文名 + 拼音/英文名）
  const keywords = new Map<string, string[]>();
  for (const site of SITES) {
    keywords.set(site.id, [site.nameKo.toLowerCase()]);
  }

  $("a").each((_, element) => {
    const $a = $(element as never);
    const href = String($a.attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("/") || href.startsWith("//")) {
      // 跳过站内相对链接（导航），只处理绝对外链
      return;
    }
    const text = String($a.text() ?? "").trim().toLowerCase();
    if (!text) {
      return;
    }
    for (const site of SITES) {
      const kws = keywords.get(site.id) ?? [];
      if (kws.some((kw) => text.includes(kw))) {
        const normalized = normalizeOrigin(href);
        if (!normalized) {
          continue;
        }
        const list = result.get(site.id) ?? [];
        if (!list.includes(normalized)) {
          list.push(normalized);
        }
        result.set(site.id, list);
        break;
      }
    }
  });

  return result;
}

/** 探测某域名是否真的是该站（https 优先，失败回落 http） */
async function probeOrigin(site: SiteDef, candidate: string): Promise<string | null> {
  const host = (() => {
    try {
      return new URL(candidate).hostname;
    } catch {
      return "";
    }
  })();
  if (!host) {
    return null;
  }

  for (const protocol of ["https", "http"]) {
    const base = `${protocol}://${host}`;
    try {
      const res = await fetch(`${base}/bbs/board.php?bo_table=wtoon`, {
        headers: HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!res.ok) {
        continue;
      }
      const body = await res.text();
      if (looksLikeSitePage(body, site.dataSite) && !looksLikeParkedPage(body)) {
        return base;
      }
    } catch {
      // 该协议不通，继续试下一个
    }
  }
  return null;
}

let inflight: Promise<void> | null = null;

/**
 * 抓发布页，探测并切换所有失效站点的域名。
 * 只在「某个站的当前域名不可用」时被调用，且并发合并。
 */
export async function discoverOrigins(): Promise<void> {
  if (inflight) {
    return inflight;
  }
  inflight = (async () => {
    console.log("[korsite] 开始从发布页发现域名:", PUBLISHER_URL);
    let publisherHtml = "";
    try {
      const res = await fetch(PUBLISHER_URL, {
        headers: HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        publisherHtml = await res.text();
      } else {
        console.log("[korsite] 发布页返回异常状态:", res.status);
      }
    } catch (error) {
      console.log("[korsite] 发布页不可达:", error instanceof Error ? error.message : error);
    }

    if (!publisherHtml) {
      console.log("[korsite] 发布页不可达，跳过域名发现");
      return;
    }

    const candidates = collectSiteCandidates(publisherHtml);
    for (const site of defaultSites()) {
      const list = candidates.get(site.id) ?? [];
      if (list.length === 0) {
        continue;
      }
      const current = getOrigin(site.id);
      // 当前域名仍可用就跳过，只修失效的
      const currentOk = await probeOrigin(site, current);
      if (currentOk) {
        console.log(`[korsite] ${site.id} 当前域名可用:`, current);
        continue;
      }
      let switched = false;
      for (const candidate of list) {
        const verified = await probeOrigin(site, candidate);
        if (verified) {
          setOrigin(site.id, verified);
          await persistOrigin(site.id, verified);
          console.log(`[korsite] ${site.id} 已切换域名: ${current} → ${verified}`);
          switched = true;
          break;
        }
      }
      if (!switched) {
        console.log(`[korsite] ${site.id} 候选均不可用，沿用: ${current}`);
      }
    }
  })();

  try {
    await inflight;
  } finally {
    inflight = null;
  }
}

/** 设置页「刷新域名」动作用：强制重新发现并返回各站当前域名 */
export async function refreshOrigins(): Promise<Record<string, string>> {
  await discoverOrigins();
  const result: Record<string, string> = {};
  for (const site of defaultSites()) {
    result[site.id] = getOrigin(site.id);
  }
  return result;
}
