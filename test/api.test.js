"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { _test } = require("../api");
test("normalizes video and photo URLs", () => {
  const video = _test.parseInputUrl(
    "https://www.tiktok.com/@creator/video/7106594312292453675?x=1",
  );
  assert.equal(video.kind, "video");
  assert.equal(video.id, "7106594312292453675");
  assert.equal(
    video.canonicalUrl,
    "https://www.tiktok.com/@creator/video/7106594312292453675",
  );
  assert.equal(
    _test.parseInputUrl(
      "https://www.tiktok.com/@creator/photo/7106594312292453675",
    ).kind,
    "photo",
  );
  assert.equal(
    _test.parseInputUrl(
      "https://www.tiktok.com/en/@creator/video/7106594312292453675",
    ).id,
    "7106594312292453675",
  );
  assert.equal(
    _test.parseInputUrl(
      "https://www.tiktok.com/login?redirect_url=https%3A%2F%2Fwww.tiktok.com%2F%40creator%2Fvideo%2F7106594312292453675",
    ).id,
    "7106594312292453675",
  );
});
test("accepts short links and rejects foreign hosts", () => {
  assert.equal(
    _test.parseInputUrl("https://vm.tiktok.com/ZM123456/").short,
    true,
  );
  assert.equal(
    _test.parseInputUrl("https://www.tiktok.com/t/ZT123abc/").short,
    true,
  );
  assert.equal(
    _test.parseInputUrl("https://m.tiktok.com/v/7106594312292453675.html").short,
    true,
  );
  assert.equal(
    _test.parseInputUrl("https://www.tiktok.com/share/video/7106594312292453675").short,
    true,
  );
  assert.throws(() =>
    _test.parseInputUrl(
      "https://example.com/@creator/video/7106594312292453675",
    ),
  );
});
test("allows expected TikTok CDN hosts", () => {
  assert.equal(
    _test.isCdnUrl("https://v16-webapp-prime.us.tiktok.com/video/a"),
    true,
  );
  assert.equal(
    _test.isCdnUrl("https://p16-sign.tiktokcdn-us.com/image/a"),
    true,
  );
  assert.equal(_test.isCdnUrl("https://evil.example/video/a"), false);
});
test("extracts universal data and normalizes no-watermark video", () => {
  const item = {
    id: "7106594312292453675",
    desc: "Example",
    author: { uniqueId: "creator", nickname: "Creator" },
    video: {
      playAddr: "https://v16-webapp-prime.us.tiktok.com/video/a",
      downloadAddr: "https://v16-webapp-prime.us.tiktok.com/download/a",
      cover: "https://p16-sign.tiktokcdn-us.com/image/a",
    },
    music: {
      title: "Sound",
      playUrl: "https://sf16-ies-music.tiktokcdn.com/audio/a",
    },
  };
  const html =
    '<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">' +
    JSON.stringify({
      __DEFAULT_SCOPE__: {
        "webapp.video-detail": { itemInfo: { itemStruct: item } },
      },
    }) +
    "</script>";
  const output = _test.normalize(_test.extractItem(html), {
    id: item.id,
    username: "creator",
    canonicalUrl: "https://www.tiktok.com/@creator/video/7106594312292453675",
  });
  assert.equal(output.items[0].type, "video");
  assert.equal(output.items[0].sourceMayContainWatermark, false);
  assert.equal(output.items[0].watermarkAdded, false);
});
test("normalizes photo slideshows", () => {
  const item = {
    id: "7106594312292453675",
    imagePost: {
      images: [
        {
          imageURL: {
            urlList: ["https://p16-sign.tiktokcdn-us.com/image/one"],
          },
        },
        {
          imageURL: {
            urlList: ["https://p16-sign.tiktokcdn-us.com/image/two"],
          },
        },
      ],
    },
  };
  const output = _test.normalize(item, {
    id: item.id,
    username: "creator",
    canonicalUrl: "https://www.tiktok.com/@creator/photo/7106594312292453675",
  });
  assert.equal(output.kind, "photo");
  assert.equal(output.items.length, 2);
});
test("normalizes alternate no-watermark CDN results", () => {
  const items = _test.alternateItems(
    {
      id: "7106594312292453675",
      play: "https://v19.tiktokcdn-us.com/video/a",
      size: 1234,
    },
    "7106594312292453675",
  );
  assert.equal(items.length, 1);
  assert.equal(items[0].type, "video");
  assert.equal(items[0].watermarkAdded, false);
  assert.equal(items[0].size, 1234);
  assert.deepEqual(
    _test.alternateItems({ id: "wrong", play: items[0].downloadUrl }, "7106594312292453675"),
    [],
  );
});
