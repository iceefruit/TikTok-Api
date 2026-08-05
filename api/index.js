"use strict";
const crypto = require("node:crypto");
const { once } = require("node:events");
const VERSION = "2.0.0";
const PAGE_LIMIT = 3000000;
const PAGE_HEADERS = {
  accept: "text/html,application/xhtml+xml,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0",
};
const SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);
const SHORT_PATH_PATTERN = /^(?:\/t\/[A-Za-z0-9_-]+|\/v\/\d+(?:\.html)?|\/share\/(?:video|item)\/\d+)(?:\/|$)/i;
class ApiError extends Error {
  constructor(code, message, status = 400, retryable = false) {
    super(message);
    Object.assign(this, { code, status, retryable });
  }
}
function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(status === 204 ? "" : JSON.stringify(body));
}
function fail(res, error, requestId) {
  const known = error instanceof ApiError;
  const current = known
    ? error
    : new ApiError(
        "INTERNAL_ERROR",
        "An unexpected error occurred.",
        500,
        true,
      );
  if (!known) console.error("[" + requestId + "]", error);
  json(res, current.status, {
    ok: false,
    requestId,
    error: {
      code: current.code,
      message: current.message,
      retryable: current.retryable,
    },
  });
}
function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function authorize(req) {
  const expected = process.env.API_KEY;
  if (!expected) {
    if (process.env.VERCEL || process.env.NODE_ENV === "production")
      throw new ApiError(
        "SERVER_MISCONFIGURED",
        "API authentication is not configured.",
        503,
        true,
      );
    return;
  }
  const bearer = /^Bearer\s+(.+)$/i.exec(
    String(req.headers.authorization || ""),
  )?.[1];
  if (!safeEqual(bearer || req.headers["x-api-key"], expected))
    throw new ApiError("UNAUTHORIZED", "Provide a valid API key.", 401);
}
function isTikTokHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "tiktok.com" || host.endsWith(".tiktok.com");
}
function postPath(pathname) {
  return String(pathname || "").match(
    /^\/(?:[a-z]{2}(?:-[A-Z]{2})?\/)?@([A-Za-z0-9._-]{1,32})\/(video|photo)\/(\d{10,30})(?:\/|$)/i,
  );
}
function nestedTikTokUrl(url) {
  for (const name of ["redirect_url", "redirect", "target", "url"]) {
    const value = url.searchParams.get(name);
    if (!value) continue;
    try {
      const nested = new URL(value);
      if (nested.protocol === "https:" && isTikTokHost(nested.hostname)) return nested;
    } catch {}
  }
  return null;
}
function parseInputUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch {
    throw new ApiError("INVALID_URL", "Provide a valid TikTok media URL.");
  }
  if (url.protocol !== "https:" || !isTikTokHost(url.hostname))
    throw new ApiError("INVALID_URL", "Only HTTPS TikTok URLs are accepted.");
  const hostname = url.hostname.toLowerCase();
  if (
    SHORT_HOSTS.has(hostname) ||
    (isTikTokHost(hostname) && SHORT_PATH_PATTERN.test(url.pathname))
  ) return { short: true, url };
  const nested = nestedTikTokUrl(url);
  if (nested) return parseInputUrl(nested.href);
  const match = postPath(url.pathname);
  if (!match)
    throw new ApiError(
      "INVALID_URL",
      "The URL must identify a TikTok video or photo post.",
    );
  return {
    short: false,
    url,
    username: match[1],
    kind: match[2],
    id: match[3],
    canonicalUrl:
      "https://www.tiktok.com/@" + match[1] + "/" + match[2] + "/" + match[3],
  };
}
async function resolveInput(value) {
  let parsed = parseInputUrl(value);
  if (!parsed.short) return parsed;
  let current = parsed.url;
  for (let count = 0; count < 5; count += 1) {
    const response = await fetch(current, {
      method: "GET",
      headers: PAGE_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    if (response.status < 300 || response.status >= 400) {
      parsed = parseInputUrl(response.url || current.href);
      if (parsed.short)
        throw new ApiError(
          "SHORT_LINK_FAILED",
          "TikTok did not resolve this short link.",
          502,
          true,
        );
      return parsed;
    }
    const location = response.headers.get("location");
    if (!location) break;
    current = new URL(location, current);
    if (!isTikTokHost(current.hostname))
      throw new ApiError(
        "UNSAFE_REDIRECT",
        "TikTok redirected to an unexpected host.",
        502,
      );
    const nested = nestedTikTokUrl(current);
    if (nested) current = nested;
    parsed = parseInputUrl(current.href);
    if (!parsed.short) return parsed;
  }
  throw new ApiError(
    "SHORT_LINK_FAILED",
    "TikTok short-link resolution exceeded the redirect limit.",
    502,
    true,
  );
}
function scriptJson(html, id) {
  const escaped = id.replace(/[.*+?^{}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    "<script[^>]+id=[\"']" + escaped + "[\"'][^>]*>([\\s\\S]*?)<\\/script>",
    "i",
  ).exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}
async function fetchPage(url) {
  const response = await fetch(url, {
    headers: PAGE_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(18000),
  });
  if ([401, 403, 429].includes(response.status))
    throw new ApiError(
      "UPSTREAM_BLOCKED",
      "TikTok blocked or rate-limited this request.",
      502,
      true,
    );
  if (response.status === 404)
    throw new ApiError(
      "MEDIA_NOT_FOUND",
      "The TikTok media was not found or is private.",
      404,
    );
  if (!response.ok)
    throw new ApiError(
      "UPSTREAM_UNAVAILABLE",
      "TikTok returned HTTP " + response.status + ".",
      502,
      true,
    );
  const html = await response.text();
  if (Buffer.byteLength(html) > PAGE_LIMIT)
    throw new ApiError(
      "UPSTREAM_INVALID",
      "TikTok returned an unexpectedly large page.",
      502,
      true,
    );
  return html;
}
function isCdnUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (host.endsWith(".tiktok.com") ||
        host.endsWith(".tiktokcdn.com") ||
        host.endsWith(".tiktokcdn-us.com") ||
        host.endsWith(".byteoversea.com") ||
        host.endsWith(".ibytedtos.com") ||
        host.endsWith(".muscdn.com"))
    );
  } catch {
    return false;
  }
}
function firstCdn(values) {
  for (const value of values.flat(Infinity)) if (isCdnUrl(value)) return value;
  return null;
}
function extractItem(html) {
  const universal = scriptJson(html, "__UNIVERSAL_DATA_FOR_REHYDRATION__");
  const item =
    universal?.__DEFAULT_SCOPE__?.["webapp.video-detail"]?.itemInfo?.itemStruct;
  if (item) return item;
  const sigi = scriptJson(html, "SIGI_STATE");
  return Object.values(sigi?.ItemModule || {})[0] || null;
}
function videoItems(item) {
  if (!item.video) return [];
  const play = firstCdn([
    item.video.playAddr,
    item.video.playAddrH264,
    item.video.bitrateInfo?.map((entry) => entry?.PlayAddr?.UrlList),
  ]);
  const download = firstCdn([item.video.downloadAddr]);
  const selected = play || download;
  if (!selected) return [];
  return [
    {
      type: "video",
      downloadUrl: selected,
      contentType: "video/mp4",
      filename: "tiktok-" + item.id + ".mp4",
      size: null,
      thumbnailUrl: firstCdn([
        item.video.originCover,
        item.video.dynamicCover,
        item.video.cover,
      ]),
      watermarkAdded: false,
      sourceMayContainWatermark: !play && selected === download,
      temporary: true,
    },
  ];
}
function photoItems(item) {
  const images = item.imagePost?.images || item.images || [];
  const output = [];
  for (const image of images) {
    const url = firstCdn([
      image?.imageURL?.urlList,
      image?.imageUrl?.urlList,
      image?.displayImage?.urlList,
      image?.urlList,
    ]);
    if (!url) continue;
    output.push({
      type: "image",
      downloadUrl: url,
      contentType: "image/jpeg",
      filename: "tiktok-" + item.id + "-" + (output.length + 1) + ".jpg",
      size: null,
      watermarkAdded: false,
      sourceMayContainWatermark: false,
      temporary: true,
    });
  }
  return output;
}
function normalize(item, source) {
  const items = photoItems(item);
  if (!items.length) items.push(...videoItems(item));
  if (!items.length)
    throw new ApiError(
      "NO_MEDIA_FOUND",
      "TikTok did not expose downloadable public media for this URL.",
      404,
      true,
    );
  return {
    id: String(item.id || source.id),
    kind: items[0].type === "image" ? "photo" : "video",
    canonicalUrl: source.canonicalUrl,
    description: item.desc || "",
    author: {
      username: item.author?.uniqueId || source.username,
      displayName: item.author?.nickname || "",
      avatarUrl: firstCdn([
        item.author?.avatarLarger,
        item.author?.avatarMedium,
        item.author?.avatarThumb,
      ]),
    },
    audio: {
      title: item.music?.title || "",
      author: item.music?.authorName || "",
      downloadUrl: firstCdn([item.music?.playUrl]),
    },
    items,
    proxyDownloads: true,
    downloadHeaders: {
      Referer: "https://www.tiktok.com/",
      "User-Agent": PAGE_HEADERS["user-agent"],
    },
    warnings: [
      "download_urls_are_temporary_and_should_be_fetched_immediately",
      "source_watermark_status_is_best_effort",
    ],
  };
}
async function proxyDownload(req, res) {
  if (req.method !== "POST")
    throw new ApiError("METHOD_NOT_ALLOWED", "Use POST for this endpoint.", 405);
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); }
    catch { throw new ApiError("INVALID_JSON", "Provide a JSON request body."); }
  }
  const mediaUrl = body?.url;
  if (!isCdnUrl(mediaUrl))
    throw new ApiError("INVALID_MEDIA_URL", "Only approved TikTok media CDN URLs can be proxied.");
  const maxBytes = Math.max(1, Math.min(50 * 1024 * 1024, Number(body?.maxBytes) || 25 * 1024 * 1024));
  const upstream = await fetch(mediaUrl, {
    headers: PAGE_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(30000),
  });
  if (!upstream.ok || !upstream.body)
    throw new ApiError("CDN_UNAVAILABLE", "TikTok's media CDN could not be reached.", 502, true);
  const contentType = upstream.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  if (!/^(video|image)\//i.test(contentType)) {
    await upstream.body.cancel().catch(() => {});
    throw new ApiError("INVALID_MEDIA", "TikTok's CDN did not return media.", 502, true);
  }
  const declaredSize = Number(upstream.headers.get("content-length") || 0);
  if (declaredSize > maxBytes) {
    await upstream.body.cancel().catch(() => {});
    throw new ApiError("FILE_TOO_LARGE", "The media exceeds the proxy size limit.", 413);
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "private, no-store");
  if (declaredSize > 0) res.setHeader("Content-Length", String(declaredSize));
  const reader = upstream.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        res.destroy(new Error("Proxy size limit exceeded"));
        return;
      }
      if (!res.write(Buffer.from(value))) await once(res, "drain");
    }
    res.end();
  } finally {
    reader.releaseLock();
  }
}
async function resolveMedia(value) {
  const source = await resolveInput(value);
  const item = extractItem(await fetchPage(source.canonicalUrl));
  if (!item)
    throw new ApiError(
      "NO_MEDIA_FOUND",
      "TikTok did not expose public media data for this URL.",
      404,
      true,
    );
  return normalize(item, source);
}
function requestInput(req) {
  const requestUrl = new URL(req.url, "https://api.local");
  if (req.method === "GET") return requestUrl.searchParams.get("url");
  if (req.method !== "POST")
    throw new ApiError(
      "METHOD_NOT_ALLOWED",
      "Use GET or POST for this endpoint.",
      405,
    );
  if (req.body && typeof req.body === "object") return req.body.url;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body).url;
    } catch {
      throw new ApiError("INVALID_JSON", "Provide a JSON body containing url.");
    }
  }
  return null;
}
function route(req) {
  return new URL(req.url, "https://api.local").pathname
    .replace(/^\/api\/v1\/?/, "")
    .replace(/\/$/, "");
}
const openapi = {
  openapi: "3.1.0",
  info: { title: "TikTok API", version: VERSION },
  paths: {
    "/api/v1/health": {
      get: { responses: { 200: { description: "Healthy" } } },
    },
    "/api/v1/media": {
      post: {
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "Resolved TikTok media" },
          401: { description: "Invalid API key" },
        },
      },
    },
    "/api/v1/download": {
      post: {
        security: [{ bearerAuth: [] }],
        responses: { 200: { description: "Streams resolved TikTok media" } },
      },
    },
  },
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
  },
};
module.exports = async (req, res) => {
  const requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("Access-Control-Allow-Origin", process.env.CORS_ORIGIN || "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, X-API-Key",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return json(res, 204, null);
  try {
    const path = route(req);
    if (path === "health")
      return json(res, 200, {
        ok: true,
        service: "tiktok-api",
        version: VERSION,
      });
    if (path === "openapi.json") return json(res, 200, openapi);
    if (!path)
      return json(res, 200, {
        ok: true,
        service: "TikTok API",
        version: VERSION,
        docs: "/api/v1/openapi.json",
      });
    if (path !== "media" && path !== "download")
      throw new ApiError("NOT_FOUND", "Route not found.", 404);
    authorize(req);
    if (path === "download") return await proxyDownload(req, res);
    return json(res, 200, {
      ok: true,
      requestId,
      platform: "tiktok",
      data: await resolveMedia(requestInput(req)),
    });
  } catch (error) {
    return fail(res, error, requestId);
  }
};
module.exports._test = {
  parseInputUrl,
  isTikTokHost,
  isCdnUrl,
  scriptJson,
  extractItem,
  normalize,
  route,
};
