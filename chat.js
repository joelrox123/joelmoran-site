// netlify/functions/chat.js
// Handles two routes:
//   POST /api/chat   -- main CMO conversation
//   POST /api/lookup -- business name lookup with web search

const ANTHROPIC_API = 'https://api.anthropic.com/v1/messages';
const HAIKU = 'claude-haiku-4-5-20251001';

exports.handler = async function(event) {
  // CORS headers for all responses
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  // Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  // Route: /api/lookup
  if (body.business) {
    return handleLookup(body.business, apiKey, headers);
  }

  // Route: /api/chat
  if (body.messages) {
    return handleChat(body, apiKey, headers);
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) };
};

// ---- LOOKUP ----
async function handleLookup(businessName, apiKey, headers) {
  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'interleaved-thinking-2025-01-31'
      },
      body: JSON.stringify({
        model: HAIKU,
        max_tokens: 300,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        system: `You are a research assistant. Given a business name, search for it and return a brief, factual summary in 2-3 sentences covering: what the business does, its approximate size or stage, and its industry. Return ONLY the summary text, no preamble, no labels, no formatting.`,
        messages: [{
          role: 'user',
          content: `Look up this business and give me a brief factual summary: "${businessName}"`
        }]
      })
    });

    const data = await res.json();
    // Extract text from content blocks (web search returns mixed blocks)
    const info = (data.content || [])
      .filter(b => b.type === 'text')
      .map(b => b.text)
      .join(' ')
      .trim();

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ info: info || '' })
    };
  } catch(e) {
    // Non-fatal -- lookup failure just means less context
    return { statusCode: 200, headers, body: JSON.stringify({ info: '' }) };
  }
}

// ---- CHAT ----
async function handleChat(body, apiKey, headers) {
  const { system, messages } = body;

  if (!messages || !Array.isArray(messages)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing messages' }) };
  }

  try {
    const res = await fetch(ANTHROPIC_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: HAIKU,
        max_tokens: 500,
        system: system || '',
        messages
      })
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Anthropic error:', err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Upstream API error' }) };
    }

    const data  = await res.json();
    const reply = (data.content || []).find(b => b.type === 'text')?.text || '';

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ reply })
    };
  } catch(e) {
    console.error('Chat error:', e);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal error' }) };
  }
}
