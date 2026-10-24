import type {
  ActionItem,
  ComicListItem,
  ImageItem,
  MetadataListItem,
  StringMap,
} from "breeze-plugin-kit";

/** 插件唯一标识，务必保持稳定 */
export const PLUGIN_ID = "7d1e0b4f-9c2a-4e8f-a3b6-5f2d8c1e9a47";

/** 通用 UA：部分站有 Cloudflare，必须带浏览器 UA */
export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** 占位图：必须是合法非空 URL */
export const PLACEHOLDER_IMAGE_URL =
  "https://cdn.jsdelivr.net/gh/k623615746/Breeze-plugin-korsite@main/assets/icon.png";

export const PAGE_SIZE = 24;

/** HTML 实体解码（覆盖 Gnuboard 常见实体） */
export function decodeEntities(input: string): string {
  if (!input || input.indexOf("&") < 0) {
    return input;
  }
  return input
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) {
    return "";
  }
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

export function cleanText(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }
  return decodeEntities(input).replace(/[\s\u3000]+/g, " ").trim();
}

/** 相对地址 → 绝对地址（按指定 origin） */
export function absoluteUrl(raw: string | null | undefined, base: string): string {
  const value = cleanText(raw);
  if (!value) {
    return "";
  }
  if (/^https?:\/\//i.test(value)) {
    return value;
  }
  if (value.startsWith("//")) {
    return `https:${value}`;
  }
  return `${base.replace(/\/$/, "")}/${value.replace(/^\//, "")}`;
}

export function createImage(input: {
  id?: string;
  url?: string;
  name?: string;
  path?: string;
  extern?: StringMap;
} = {}): ImageItem {
  const url = cleanText(input.url);
  return {
    id: String(input.id ?? ""),
    url: url || PLACEHOLDER_IMAGE_URL,
    name: String(input.name ?? ""),
    path: String(input.path ?? "").trim() || "cover/placeholder.png",
    extern: input.extern ?? {},
  };
}

export function createActionItem(name: string, extern: StringMap = {}): ActionItem {
  return {
    name: cleanText(name),
    onTap: null,
    extern,
  };
}

export function createMetadata(
  type: string,
  name: string,
  values: ReadonlyArray<string>,
): MetadataListItem {
  return {
    type,
    name,
    value: values
      .map((item) => cleanText(item))
      .filter((item) => item.length > 0)
      .map((item) => createActionItem(item)),
  };
}

/** 判断字符串是否含韩文（谚文）字符 */
export function containsHangul(input: string): boolean {
  return /[\uac00-\ud7af]/.test(input);
}

/** 判断字符串是否含中文（CJK 统一表意文字）字符 */
export function containsCjk(input: string): boolean {
  return /[\u4e00-\u9fff]/.test(input);
}

/** 构建列表条目（统一入口） */
export function toComicListItem(input: {
  id: string;
  title: string;
  subtitle?: string;
  finished?: boolean;
  coverUrl?: string;
  raw?: Record<string, unknown>;
}): ComicListItem {
  const title = cleanText(input.title) || `未命名-${input.id.slice(0, 8)}`;
  const subtitle = cleanText(input.subtitle);
  const cover = cleanText(input.coverUrl);

  return {
    source: PLUGIN_ID,
    id: input.id,
    title,
    subtitle,
    finished: input.finished ?? false,
    likesCount: 0,
    viewsCount: 0,
    updatedAt: "",
    cover: createImage({
      id: input.id,
      url: cover,
      name: title,
      path: `comic/${input.id}/cover.jpg`,
      extern: {},
    }),
    metadata: [],
    raw: input.raw ?? { id: input.id, title },
    extern: {},
  };
}
