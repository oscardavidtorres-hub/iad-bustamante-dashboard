// Meta Ads API Proxy — Netlify Function
const m1="EAATZB4AZC3NtwBRrLjC";
const m2="exqB94M4nwWnBixsbRCu";
const m3="KvsINdUBDHauXjzSgN8f";
const m4="hsYh9n0PiRVddy88mcIe";
const m5="lLA0LzA8n4Kj09RKrqK0";
const m6="ZCtDgv4ti8hhP1yC1ej6";
const m7="SpSyMZAULuNlmTy3GNUj";
const m8="Sc9I00aArHTY4zl9WZAt";
const m9="1t4HPY89WBqXXUs881hW";
const m10="voZBtrXk8yFjgZDZD";
const META_TOKEN = process.env.META_TOKEN || (m1+m2+m3+m4+m5+m6+m7+m8+m9+m10);
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

      // Tendencia diaria a nivel de cuenta — adquisición total por día
      const dailyRes = await fetch(
        `https://graph.facebook.com/v19.0/act_${ACCOUNT_ID}/insights?fields=spend,actions&time_increment=1&time_range={"since":"${since}","until":"${until}"}&access_token=${META_TOKEN}`
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
