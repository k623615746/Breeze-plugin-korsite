/**
 * fetch 封装：站内请求（相对路径 + 域名自愈重试）、图片下载（二进制透传）
 */

import { USER_AGENT, absoluteUrl, cleanText } from "./common";
import {
  getOrigin,
  getSiteById,
  loadPersistedOrigin,
  looksLikeParkedPage,
  originHost,
} from "./sites";
import { discoverOrigins } from "./site";

/** 每个站点的域名只从持久化配置恢复一次 */
const originLoaded = new Set<string>();

async function ensureOriginLoaded(siteId: string): Promise<void> {
  if (originLoaded.has(siteId)) {
    return;
  }
  originLoaded.add(siteId);
  try {
    await loadPersistedOrigin(siteId);
  } catch {
    // 恢复失败沿用默认域名
  }
}

function buildHeaders(url: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "User-Agent": USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "ko-KR,ko;q=0.9,zh-CN,zh;q=0.8,en;q=0.7",
    Referer: url,
    ...extra,
  };
}

/** 把路径里的非 ASCII 字符（韩文等）做 URL 编码，QuickJS fetch 不接受原始 Unicode */
function encodePath(path: string): string {
  // 拆出 query（? 之后不整体编码，但值仍需编码）
  const qIndex = path.indexOf("?");
  const pathPart = qIndex >= 0 ? path.slice(0, qIndex) : path;
  const queryPart = qIndex >= 0 ? path.slice(qIndex + 1) : "";

  const encodedPath = pathPart
    .split("/")
    .map((seg) => encodeURIComponent(seg))
    .join("/");

  if (!queryPart) {
    return encodedPath;
  }
  // query 里已 encodeURIComponent 过的值保留，未编码的韩文补编码
  const encodedQuery = queryPart
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) {
        return encodeURIComponent(pair);
      }
      const key = pair.slice(0, eq);
      const value = pair.slice(eq + 1);
      // 值若是 %XX 形式说明已编码，直接保留；否则编码
      const encodedValue = /%[0-9A-Fa-f]{2}/.test(value) ? value : encodeURIComponent(value);
      return `${key}=${encodedValue}`;
    })
    .join("&");

  return `${encodedPath}?${encodedQuery}`;
}

/** 单次站内请求；失败返回 null 而不抛错，交给上层决定是否换域名 */
async function trySiteFetch(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: buildHeaders(url),
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.log("[korsite] 请求失败:", res.status, url);
      return null;
    }
    const text = await res.text();
    if (!cleanText(text)) {
      console.log("[korsite] 响应为空:", url);
      return null;
    }
    if (looksLikeParkedPage(text)) {
      console.log("[korsite] 命中停放页/CF 校验:", url);
      return null;
    }
    return text;
  } catch (error) {
    console.log("[korsite] 请求异常:", url, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * 请求站内页面（传站点 ID + 相对路径）。
 * 域名失效时自动从 korsite.net 发现最新域名并重试一次。
 */
export async function fetchSitePath(
  siteId: string,
  path: string,
  options: { timeoutMs?: number } = {},
): Promise<string> {
  await ensureOriginLoaded(siteId);

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const encodedPath = encodePath(normalizedPath);
  const timeoutMs = options.timeoutMs ?? 20000;

  const firstOrigin = getOrigin(siteId);
  const first = await trySiteFetch(`${firstOrigin}${encodedPath}`, timeoutMs);
  if (first !== null) {
    return first;
  }

  console.log("[korsite] 当前域名请求失败，触发域名发现:", siteId, firstOrigin);
  try {
    await discoverOrigins();
  } catch (error) {
    console.log("[korsite] 域名发现失败:", error instanceof Error ? error.message : error);
  }

  const nextOrigin = getOrigin(siteId);
  if (nextOrigin && nextOrigin !== firstOrigin) {
    const second = await trySiteFetch(`${nextOrigin}${encodedPath}`, timeoutMs);
    if (second !== null) {
      return second;
    }
    console.log("[korsite] 新域名重试仍失败:", nextOrigin);
  }

  const site = getSiteById(siteId);
  const label = site ? `${site.nameZh}(${site.id})` : siteId;
  throw new Error(`请求 ${label} 失败，且未找到可用域名`);
}

/** 下载图片（二进制透传，必须带 offload 头） */
export async function fetchImage(url: string, timeoutMs = 30000): Promise<Uint8Array> {
  const target = absoluteUrl(url, "");
  if (!target) {
    throw new Error("图片地址为空");
  }
  const res = await fetch(target, {
    headers: buildHeaders(target, {
      "x-rquickjs-host-offload-binary-v1": "1",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    }),
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`图片下载失败（HTTP ${res.status}）`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

/** 把当前某站域名拼成完整 URL（供 extern 透传或调试） */
export function siteAbsoluteUrl(siteId: string, path: string): string {
  const origin = getOrigin(siteId);
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${origin}${p}`;
}

export function siteHost(siteId: string): string {
  return originHost(siteId);
}
