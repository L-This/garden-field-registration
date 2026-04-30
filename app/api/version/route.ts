export async function GET() {
  return Response.json({
    version: process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_BUILD_ID || Date.now().toString(),
  });
}
