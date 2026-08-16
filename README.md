# TikTok Media API

A Node.js 22 and Vercel serverless API that resolves public TikTok videos and photo posts into temporary direct media URLs. It supports standard links and short links, returns video or slideshow metadata, and can proxy approved TikTok CDN media for clients that cannot fetch TikTok directly.

The resolver reads TikTok's public page data and best-effort alternate CDN data. It does not log in to TikTok and cannot access private, deleted, age-restricted, or region-blocked posts.

## Features

- Resolves TikTok video posts and photo slideshow posts.
- Supports `vm.tiktok.com`, `vt.tiktok.com`, `/t/`, `/v/`, and share links.
- Returns direct temporary CDN URLs and media metadata.
- Preserves video thumbnails as previews without confusing them for video media.
- Optional `/download` proxy streams approved video or image CDN URLs.
- Bearer-token or `X-API-Key` authentication.
- CORS configuration, health endpoint, and OpenAPI document.
- Clear retryable errors for upstream blocks, timeouts, and CDN failures.

## API Endpoints

All endpoints are available under `/api/v1` after deployment.

| Method | Endpoint | Authentication | Description |
|---|---|---|---|
| `GET` | `/api/v1/health` | No | Health and version information |
| `GET` | `/api/v1/openapi.json` | No | OpenAPI 3.1 document |
| `GET` | `/api/v1/media?url=...` | Yes | Resolve one TikTok URL |
| `POST` | `/api/v1/media` | Yes | Resolve one TikTok URL from JSON |
| `POST` | `/api/v1/download` | Yes | Stream one approved CDN URL through the API |

## Authentication

Set `API_KEY` in the Vercel project and send:

```http
Authorization: Bearer YOUR_API_KEY
```

or:

```http
X-API-Key: YOUR_API_KEY
```

Authentication is required in Vercel and production environments. Local development without `API_KEY` is allowed for convenience.

## Resolve Media

### Request

```bash
curl -X POST "https://your-domain.vercel.app/api/v1/media" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.tiktok.com/@creator/video/7106594312292453675"}'
```

`GET` is also supported:

```bash
curl "https://your-domain.vercel.app/api/v1/media?url=https%3A%2F%2Fvm.tiktok.com%2FZ123456%2F" \
  -H "Authorization: Bearer YOUR_API_KEY"
```

### Video response

```json
{
  "ok": true,
  "requestId": "uuid",
  "platform": "tiktok",
  "data": {
    "id": "7106594312292453675",
    "kind": "video",
    "canonicalUrl": "https://www.tiktok.com/@creator/video/7106594312292453675",
    "description": "Post description",
    "author": {
      "username": "creator",
      "displayName": "Creator",
      "avatarUrl": "https://...tiktokcdn.com/..."
    },
    "items": [
      {
        "type": "video",
        "downloadUrl": "https://...tiktokcdn.com/...",
        "contentType": "video/mp4",
        "filename": "tiktok-7106594312292453675.mp4",
        "thumbnailUrl": "https://...tiktokcdn.com/...",
        "temporary": true,
        "watermarkAdded": false,
        "sourceMayContainWatermark": false
      }
    ],
    "proxyDownloads": true,
    "downloadHeaders": {
      "Referer": "https://www.tiktok.com/",
      "User-Agent": "Mozilla/5.0"
    },
    "warnings": [
      "download_urls_are_temporary_and_should_be_fetched_immediately",
      "source_watermark_status_is_best_effort"
    ]
  }
}
```

Photo posts return one `image` item per slide. CDN URLs are temporary; fetch them immediately or use the download proxy.

## Download Proxy

Use the proxy when the client environment cannot fetch TikTok CDN URLs directly:

```bash
curl -X POST "https://your-domain.vercel.app/api/v1/download" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://v19.tiktokcdn-us.com/video/example"}' \
  --output tiktok-media.mp4
```

The proxy accepts only approved HTTPS TikTok CDN hosts, streams `video/*` or `image/*` content, and limits responses to 50 MB. The default request limit is 25 MB; clients may send `maxBytes` up to 50 MB.

## Errors

Errors use a consistent response format:

```json
{
  "ok": false,
  "requestId": "uuid",
  "error": {
    "code": "UPSTREAM_BLOCKED",
    "message": "TikTok blocked or rate-limited this request.",
    "retryable": true
  }
}
```

Common codes include `INVALID_URL`, `UNAUTHORIZED`, `SHORT_LINK_FAILED`, `MEDIA_NOT_FOUND`, `NO_MEDIA_FOUND`, `UPSTREAM_BLOCKED`, `UPSTREAM_TIMEOUT`, `CDN_UNAVAILABLE`, `INVALID_MEDIA_URL`, and `FILE_TOO_LARGE`.

## Deployment

### Vercel

1. Import this repository into Vercel.
2. Set the `API_KEY` environment variable.
3. Optionally set `CORS_ORIGIN` to your exact allowed origin.
4. Deploy with the Node.js 22 runtime defined in `package.json`.

### Local development

```bash
npm install
npm run check
```

Use a Vercel-compatible local runner or a preview deployment to test the complete request path. Never commit `.env` files, API keys, or session data.

## Supported URLs

- `https://www.tiktok.com/@user/video/1234567890`
- `https://www.tiktok.com/@user/photo/1234567890`
- `https://vm.tiktok.com/...`
- `https://vt.tiktok.com/...`
- `https://www.tiktok.com/t/...`
- `https://www.tiktok.com/share/video/...`
- `https://m.tiktok.com/v/...`

Only HTTPS TikTok URLs and approved TikTok CDN URLs are accepted.

## License

[MIT](LICENSE) (c) 2026 [iceefruit](https://github.com/iceefruit)
