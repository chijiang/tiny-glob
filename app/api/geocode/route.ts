import { NextRequest } from 'next/server';
import { z } from 'zod';
import { reverseGeocode } from '@/lib/nominatim';

export const runtime = 'nodejs';

const Body = z.object({ lat: z.number(), lng: z.number() });

export async function POST(req: NextRequest) {
  let input;
  try {
    input = Body.parse(await req.json());
  } catch {
    return new Response('bad request', { status: 400 });
  }
  const place = await reverseGeocode(input);
  if (!place) {
    return Response.json({ error: 'no place found' }, { status: 404 });
  }
  return Response.json(place);
}
