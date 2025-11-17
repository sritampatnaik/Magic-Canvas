import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const agentId = process.env.ELEVENLABS_AGENT_ID;
    
    if (!apiKey) {
      return NextResponse.json({ error: 'ElevenLabs API key not configured' }, { status: 500 });
    }
    
    if (!agentId) {
      return NextResponse.json({ error: 'ElevenLabs Agent ID not configured' }, { status: 500 });
    }

    // Call ElevenLabs API to get signed URL for the conversation
    const response = await fetch(`https://api.elevenlabs.io/v1/convai/conversation/get_signed_url?agent_id=${agentId}`, {
      method: 'GET',
      headers: {
        'xi-api-key': apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('ElevenLabs API error:', errorText);
      return NextResponse.json({ error: 'Failed to get signed URL from ElevenLabs' }, { status: response.status });
    }

    const data = await response.json();
    return NextResponse.json({ signedUrl: data.signed_url });
  } catch (error: unknown) {
    console.error('ElevenLabs signed URL error:', error);
    const message = error instanceof Error ? error.message : 'Failed to get signed URL';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

