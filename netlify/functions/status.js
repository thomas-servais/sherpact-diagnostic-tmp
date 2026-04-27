const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  const { id } = event.queryStringParameters || {};

  if (!id) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing id' }) };
  }

  try {
    const store = getStore({ name: 'diagnostics', siteID: process.env.SITE_ID, token: process.env.NETLIFY_TOKEN });
    const data = await store.get(id);

    if (!data) {
      return { statusCode: 200, headers, body: JSON.stringify({ ready: false }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ready: true, analysis: JSON.parse(data) })
    };
  } catch (err) {
    console.error('status error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
