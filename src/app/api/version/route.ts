export async function GET() {
  return Response.json({
    version: process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(),
  });
}
