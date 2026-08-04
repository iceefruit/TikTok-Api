# TikTok API

Private, Discord-oriented Vercel API that resolves public TikTok videos and photo posts to temporary TikTok CDN URLs. It does not re-encode media or add watermarks.

Send POST /api/v1/media with Bearer authentication and a JSON body containing the TikTok URL. GET with a url query is also supported. The response contains Discord-ready items with temporary download URLs, filenames, media types, and best-effort watermark status.

Normal video/photo links and vm.tiktok.com or vt.tiktok.com short links are supported. Private, deleted, age-restricted, and region-blocked posts are not.

Set API_KEY in Vercel. CORS_ORIGIN is optional. Never commit API keys or session data.

Run npm test and npm run check. TikTok CDN downloads should be tested from the Discord bot hosting environment because network and regional accessibility can vary.
