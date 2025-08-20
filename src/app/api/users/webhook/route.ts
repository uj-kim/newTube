import { headers } from "next/headers";
import { Webhook } from "svix";
import { WebhookEvent } from "@clerk/nextjs/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const SIGNING_SECRET = process.env.CLERK_SIGNING_SECRET;

  if (!SIGNING_SECRET) {
    throw new Error(
      "Error: Please add CLERK_SIGNING_SECRET from Clerk Dashboard to .env or .env.local"
    );
  }

  // 새 웹훅 인스턴스 생성(초기화)
  const wh = new Webhook(SIGNING_SECRET);

  // 검증에 필요한 헤더 정보 가져오기
  // clerk에서 생성된 사용자 정보인지, 무작위 요청인지 검증
  const headerPayload = await headers();
  const svix_id = headerPayload.get("svix-id");
  const svix_timestamp = headerPayload.get("svix-timestamp");
  const svix_signature = headerPayload.get("svix-signature");

  // 헤더 중 이러한 정보가 누락되어 있다면, 누군가 엔드포인트에 접근하려는 의미이므로 웹훅 핸들러가 아님.
  if (!svix_id || !svix_timestamp || !svix_signature) {
    return new Response("Error: Missing Svix headers", {
      status: 400,
    });
  }

  // 검증 통과 후 body 가져옴
  const payload = await req.json();
  const body = JSON.stringify(payload);

  let evt: WebhookEvent;

  // 받아온 headers로 Webhook 검증
  try {
    evt = wh.verify(body, {
      "svix-id": svix_id,
      "svix-timestamp": svix_timestamp,
      "svix-signature": svix_signature,
    }) as WebhookEvent;
  } catch (err) {
    console.error("Error: Could not verify webhook:", err);
    return new Response("Error: verification error", {
      status: 400,
    });
  }

  // event에 접근
  const eventType = evt.type;

  if (eventType === "user.created") {
    const { data } = evt;
    // Handle user.created event
    await db.insert(users).values({
      clerkId: data.id,
      name: `${data.first_name} ${data.last_name}`,
      imageUrl: data.image_url,
    });
  }

  if (eventType === "user.deleted") {
    const { data } = evt;

    if (!data.id) {
      return new Response("Missing user id", { status: 400 });
    }
    await db.delete(users).where(eq(users.clerkId, data.id));
  }

  if (eventType === "user.updated") {
    const { data } = evt;

    await db
      .update(users)
      .set({
        name: `${data.first_name} ${data.last_name}`,
        imageUrl: data.image_url,
      })
      .where(eq(users.clerkId, data.id));
  }
  return new Response("Webhook received", { status: 200 });
}
