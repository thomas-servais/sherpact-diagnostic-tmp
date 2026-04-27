const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const { id } = event.queryStringParameters || {};

  if (!id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing id' }) };
  }

  const store = getStore('diagnostics');
  const data = await store.get(id);

  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*'
  };

  if (!data) {
    return { statusCode: 200, headers, body: JSON.stringify({ ready: false }) };
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ ready: true, analysis: JSON.parse(data) })
  };
};
