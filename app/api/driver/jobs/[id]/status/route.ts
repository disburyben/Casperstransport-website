export const dynamic = 'force-dynamic';
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  return Response.json({ message: 'Status update endpoint' });
}
