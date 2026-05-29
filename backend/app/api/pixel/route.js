import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

// 43-byte transparent 1x1 GIF
const PIXEL = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (id) {
    const event = {
      ts: Date.now(),
      ua: request.headers.get("user-agent") || "",
      ip: request.headers.get("x-forwarded-for") || "",
    };

    try {
      await redis.rpush(`opens:${id}`, JSON.stringify(event));
    } catch (e) {
      // swallow, still return pixel
    }
  }

  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "private, no-store, no-cache, must-revalidate, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Surrogate-Control": "no-store",
      Pragma: "no-cache",
      Expires: "0",
      ETag: `"${Date.now()}"`,
      Vary: "*",
    },
  });
}
