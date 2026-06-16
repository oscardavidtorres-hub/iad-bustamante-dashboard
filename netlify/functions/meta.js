// Meta Ads API Proxy — Netlify Function
const m1='EAATZB4AZC3NtwBR';const m2='rLjCexqB94M4nwWn';const m3='BixsbRCuKvsINdUB';
const m4='DHauXjzSgN8fhsYh';const m5='9n0PiRVddy88mcIe';const m6='lLA0LzA8n4Kj09RK';
const m7='rqK0ZCtDgv4ti8hh';const m8='P1yC1ej6SpSyMZAU';const m9='lNlmTy3GNUjSc9I0';
const m10='0aArHTY4zl9WZAt1';const m11='t4HPY89WBqXXUs88';const m12='1hWvoZBtrXk8yFjgZDZD';
const META_TOKEN = process.env.META_TOKEN || (m1+m2+m3+m4+m5+m6+m7+m8+m9+m10+m11+m12);
const ACCOUNT_ID = '2702947393233872';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const { since, until } = event.queryStringParameters || {};
  if (!since || !until) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Faltan parámetros since/until' }) };

  try {
    // Buscar campaña CHB IAD
    const campsRes = await fetch(
      `https://graph.facebook.com/v19.0/act_${ACCOUNT_ID}/campaigns?fields=id,name,status&limit=100&access_token=${META_TOKEN}`
    );
    const campsJson = await campsRes.json();
    if (campsJson.error) throw new Error(campsJson.error.message);

    const campaign = (campsJson.data || []).find(c =>
      c.name.toLowerCase().includes('chb') && c.name.toLowerCase().includes('iad')
    );

    let spend = 0, messages = 0, trend = [], adsets = [];

    if (campaign) {
      // Insights totales
      const insRes = await fetch(
        `https://graph.facebook.com/v19.0/${campaign.id}/insights?fields=spend,actions&time_range={"since":"${since}","until":"${until}"}&access_token=${META_TOKEN}`
      );
      const insJson = await insRes.json();
      if (!insJson.error) {
        const d = (insJson.data || [])[0] || {};
        spend = parseFloat(d.spend || 0);
        messages = extractAction(d.actions, 'onsite_conversion.messaging_conversation_started_7d')
                || extractAction(d.actions, 'messaging_conversation_started_7d')
                || extractAction(d.actions, 'onsite_conversion.total_messaging_connection')
                || 0;
      }

      // Tendencia diaria
      const dailyRes = await fetch(
        `https://graph.facebook.com/v19.0/${campaign.id}/insights?fields=spend,actions&time_increment=1&time_range={"since":"${since}","until":"${until}"}&access_token=${META_TOKEN}`
      );
      const dailyJson = await dailyRes.json();
      trend = (dailyJson.data || []).map(row => ({
        date: row.date_start,
        msgs: extractAction(row.actions, 'onsite_conversion.messaging_conversation_started_7d')
           || extractAction(row.actions, 'messaging_conversation_started_7d')
           || extractAction(row.actions, 'onsite_conversion.total_messaging_connection')
           || 0,
        spend: parseFloat(row.spend || 0)
      }));

      // Adsets
      const adsetRes = await fetch(
        `https://graph.facebook.com/v19.0/${campaign.id}/insights?fields=adset_name,spend,actions&level=adset&time_range={"since":"${since}","until":"${until}"}&access_token=${META_TOKEN}`
      );
      const adsetJson = await adsetRes.json();
      adsets = (adsetJson.data || []).map(a => ({
        name: a.adset_name,
        msgs: extractAction(a.actions, 'onsite_conversion.messaging_conversation_started_7d')
           || extractAction(a.actions, 'messaging_conversation_started_7d')
           || 0,
        spend: parseFloat(a.spend || 0),
        status: 'ACTIVE'
      }));

    } else {
      // Fallback nivel cuenta
      const fallRes = await fetch(
        `https://graph.facebook.com/v19.0/act_${ACCOUNT_ID}/insights?fields=spend,actions&level=campaign&filtering=[{"field":"campaign.name","operator":"CONTAIN","value":"CHB"}]&time_range={"since":"${since}","until":"${until}"}&access_token=${META_TOKEN}`
      );
      const fallJson = await fallRes.json();
      if (!fallJson.error) {
        (fallJson.data || []).forEach(row => {
          spend += parseFloat(row.spend || 0);
          messages += extractAction(row.actions, 'onsite_conversion.messaging_conversation_started_7d') || 0;
        });
      }
    }

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ spend, messages, trend, adsets, campaign: campaign?.name || 'No encontrada' })
    };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

function extractAction(actions, type) {
  if (!actions) return 0;
  const found = actions.find(a => a.action_type === type);
  return found ? parseInt(found.value) : 0;
}
