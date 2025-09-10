// NOTE: 유료 플랜 결제시 가능한 기능

import { db } from "@/db";
import { videos } from "@/db/schema";
import { serve } from "@upstash/workflow/nextjs";
import { and, eq } from "drizzle-orm";
import { UTApi } from "uploadthing/server";

interface InputType {
  userId: string;
  videoId: string;
  prompt: string;
}

type ReplicateStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "queued";

interface ReplicatePrediction {
  id: string;
  status: ReplicateStatus;
  output?: unknown; // string | string[] | object (모델별 상이)
  error?: string | null;
}

// const REPLICATE_OWNER = "deepseek-ai";
// const REPLICATE_MODEL = "janus-pro-7b";
const REPLICATE_MODEL_VERSION = process.env.REPLICATE_MODEL_VERSION;
const WIDTH = 1792;
const HEIGHT = 1024;
const POLL_TIMEOUT_MS = 60_000; // 최대 대기 60초
const POLL_INTERVAL_MS = 1_500;

if (!process.env.REPLICATE_API_TOKEN) {
  throw new Error("Missing REPLICATE_API_TOKEN");
}
if (!REPLICATE_MODEL_VERSION) {
  throw new Error("Missing REPLICATE_MODEL_VERSION");
}

export const { POST } = serve(async (context): Promise<void> => {
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new Error("Missing REPLICATE_API_TOKEN");
  }

  const utapi = new UTApi();
  const input = context.requestPayload as InputType;
  const { videoId, userId, prompt } = input;

  const video = await context.run("get-video", async () => {
    const [existingVideo] = await db
      .select()
      .from(videos)
      .where(and(eq(videos.id, videoId), eq(videos.userId, userId)));

    if (!existingVideo) throw new Error("Not found");
    return existingVideo;
  });

  const prevKey =
    (video as { thumbnailKey?: string | null }).thumbnailKey ?? null;

  // 1) Replicate 생성 요청

  let prediction: ReplicatePrediction;
  try {
    const { body } = await context.call<ReplicatePrediction>(
      "replicate-create-prediction",
      {
        url: `https://api.replicate.com/v1/predictions`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: {
          version: REPLICATE_MODEL_VERSION,
          input: {
            prompt,
            width: WIDTH,
            height: HEIGHT,
            num_outputs: 1,
          },
        },
      }
    );

    prediction = body;
  } catch (err) {
    throw new Error("Replicate create failed:" + err);
  }

  // 2) 상태 폴링(타임아웃 가드)
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (
    prediction.status === "starting" ||
    prediction.status === "processing" ||
    prediction.status === "queued"
  ) {
    if (Date.now() > deadline) {
      throw new Error("Replicate timeout");
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const { body: polled } = await context.call<ReplicatePrediction>(
      "replicate-get-prediction",
      {
        url: `https://api.replicate.com/v1/predictions/${prediction.id}`,
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        },
      }
    );
    prediction = polled;
  }

  if (prediction.status !== "succeeded") {
    throw new Error(prediction.error || "Image generation failed");
  }

  // 3) 출력 파싱 (URL 우선)
  const tempThumbnailUrl = extractImageUrl(prediction.output);
  if (!tempThumbnailUrl) {
    throw new Error("No image URL in Replicate output");
  }

  // 4) 새 이미지 업로드 (UploadThing)
  const uploaded = await context.run("upload-thumbnail", async () => {
    type UploadThingFile = { key: string; url: string };
    function firstUploadThingFile(result: unknown): UploadThingFile | null {
      if (!result || typeof result !== "object") return null;
      const data = (result as Record<string, unknown>).data;
      if (!Array.isArray(data) || data.length === 0) return null;

      const f = data[0];
      if (!f || typeof f !== "object") return null;

      const key = (f as Record<string, unknown>).key;
      const url = (f as Record<string, unknown>).url;
      return typeof key === "string" && typeof url === "string"
        ? { key, url }
        : null;
    }

    const up = await utapi.uploadFilesFromUrl(tempThumbnailUrl);
    const file = firstUploadThingFile(up);
    if (!file) throw new Error("UPLOAD_FAILED");
    return file;
  });

  // 5) DB에 새 썸네일 반영
  await context.run("update-video", async () => {
    await db
      .update(videos)
      .set({
        thumbnailKey: uploaded.key,
        thumbnailUrl: uploaded.url,
      })
      .where(and(eq(videos.id, video.id), eq(videos.userId, video.userId)));
  });

  // 6) 이전 파일 있으면 삭제(마지막에)
  if (prevKey) {
    await context.run("delete-old-thumbnail", async () => {
      await utapi.deleteFiles(prevKey);
    });
  }
});

// ---- helpers ----
function extractImageUrl(output: unknown): string | undefined {
  if (!output) return undefined;

  // string 자체가 URL/data URL인 경우
  if (typeof output === "string") {
    return isImgUrlLike(output) ? output : undefined;
  }

  // 배열: [url, ...] 또는 [{ url: ... }, ...]
  if (Array.isArray(output)) {
    const first = output[0];
    if (typeof first === "string" && isImgUrlLike(first)) return first;
    if (first && typeof first === "object") {
      const maybe =
        (first as Record<string, unknown>).url ??
        (first as Record<string, unknown>).image ??
        (first as Record<string, unknown>).src;
      if (typeof maybe === "string" && isImgUrlLike(maybe)) return maybe;
    }
  }

  // 객체: { url: "..." } 형태
  if (typeof output === "object") {
    const maybe =
      (output as Record<string, unknown>).url ??
      (output as Record<string, unknown>).image ??
      (output as Record<string, unknown>).src;
    if (typeof maybe === "string" && isImgUrlLike(maybe)) return maybe;
  }

  return undefined;
}

function isImgUrlLike(s: string): boolean {
  return s.startsWith("http") || s.startsWith("data:image/");
}
