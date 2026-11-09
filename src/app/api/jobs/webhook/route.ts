export const runtime = "nodejs";

export async function POST() {
  return Response.json(
    { error: "This webhook was retired. The independent worker saves gateway results." },
    { status: 410 },
  );
}
