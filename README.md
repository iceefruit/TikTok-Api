# TikTok API

A fast, serverless-oriented API built for Vercel that resolves public TikTok videos and photo posts into temporary, direct TikTok CDN URLs. This API fetches the original media directly without re-encoding or adding watermarks, making it ideal for Discord bots and other platforms where you want to embed original media cleanly.

## Features

- **Direct CDN Links:** Returns the actual TikTok media URLs without watermarks (best effort).
- **Supports Multiple Formats:** Resolves both standard videos and photo slide posts.
- **URL Support:** Handles standard links, as well as `vm.tiktok.com` and `vt.tiktok.com` shortlinks.
- **Serverless Ready:** Designed to be deployed seamlessly on Vercel as a serverless function.

*Note: Private, deleted, age-restricted, and region-blocked posts are not supported.*

## Usage

### Endpoint

**POST** `/api/v1/media`
*(Also supports GET requests with a `url` query parameter)*

### Request Headers

- `Authorization: Bearer <YOUR_API_KEY>`

### Request Body (JSON)

```json
{
  "url": "https://www.tiktok.com/@user/video/1234567890"
}
```

### Response

The response provides a structured payload containing temporary download URLs, filenames, and media types, which can be easily consumed by Discord bots or client applications.

## Setup & Deployment

1. **Deploy to Vercel:** Deploy the repository to your Vercel account.
2. **Environment Variables:** Set the `API_KEY` in your Vercel project settings. This acts as your Bearer token.
3. **CORS:** You can optionally set the `CORS_ORIGIN` variable to restrict access.

> **Warning:** Never commit your `API_KEY` or session data to a public repository.

## Development

Run a local syntax check with:

```bash
npm run check
```

*Note: TikTok CDN downloads should ideally be tested from your intended hosting environment (e.g., your Discord bot's server), as network and regional accessibility can vary.*
