import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

/** Issues short-lived client-upload tokens so the browser streams the video
 *  straight to Vercel Blob (bypasses backend body limits, survives Render restarts). */
export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["video/mp4", "video/quicktime", "video/x-matroska", "video/webm"],
        maximumSizeInBytes: 800 * 1024 * 1024,
        addRandomSuffix: true,
      }),
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 400 });
  }
}

export async function GET() {
  return Response.json({ enabled: !!process.env.BLOB_READ_WRITE_TOKEN });
}
