const META_TOKEN = process.env.META_TOKEN;
const ACCOUNT_ID = '2702947393233872';
const CAMPAIGN_FILTER = '(CHB) IAD - WhatsApp - ESTADOS';

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
    // 1. Buscar campaña por nombre
    const campsUrl = `https://graph.facebook.com/v19.0/act_${ACCOUNT_ID}/campaigns?fields=id,name,status&limit=100&access_token=${META_TOKEN}`;
    const campsRes = await fetch(campsUrl);
    const campsJson = await campsRes.json();

    if (campsJson.error) throw new Error(campsJson.error.message);

    const campaign = (campsJson.data || []).find(c =>
      c.name.toLowerCase().includes('chb') && c.name.toLowerCase().includes('iad')
    );

    let spend = 0, messages = 0, trend = [], adsets = [];

    if (campaign) {
      // 2. Insights de la campaña
      const insUrl = `https://graph.facebook.com/v19.0/${campaign.id}/insights`
        + `?fields=spend,actions`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&access_token=${META_TOKEN}`;
      const insRes  = await fetch(insUrl);
      const insJson = await insRes.json();
      if (insJson.error) throw new Error(insJson.error.message);

      const d = (insJson.data || [])[0] || {};
      spend    = parseFloat(d.spend || 0);
      messages = extractAction(d.actions, 'onsite_conversion.messaging_conversation_started_7d')
              || extractAction(d.actions, 'messaging_conversation_started_7d')
              || extractAction(d.actions, 'onsite_conversion.total_messaging_connection')
              || 0;

      // 3. Tendencia diaria
      const dailyUrl = `https://graph.facebook.com/v19.0/${campaign.id}/insights`
        + `?fields=spend,actions&time_increment=1`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&access_token=${META_TOKEN}`;
      const dailyRes  = await fetch(dailyUrl);
      const dailyJson = await dailyRes.json();
      trend = (dailyJson.data || []).map(row => ({
        date: row.date_start,
        msgs: extractAction(row.actions, 'onsite_conversion.messaging_conversation_started_7d')
           || extractAction(row.actions, 'messaging_conversation_started_7d')
           || extractAction(row.actions, 'onsite_conversion.total_messaging_connection')
           || 0,
        spend: parseFloat(row.spend || 0)
      }));

      // 4. Adsets
      const adsetUrl = `https://graph.facebook.com/v19.0/${campaign.id}/insights`
        + `?fields=adset_name,spend,actions&level=adset`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&access_token=${META_TOKEN}`;
      const adsetRes  = await fetch(adsetUrl);
      const adsetJson = await adsetRes.json();
      adsets = (adsetJson.data || []).map(a => ({
        name:  a.adset_name,
        msgs:  extractAction(a.actions, 'onsite_conversion.messaging_conversation_started_7d')
            || extractAction(a.actions, 'messaging_conversation_started_7d')
            || 0,
        spend: parseFloat(a.spend || 0),
        status: 'ACTIVE'
      }));

    } else {
      // Fallback: nivel de cuenta con filtro CHB
      const fallUrl = `https://graph.facebook.com/v19.0/act_${ACCOUNT_ID}/insights`
        + `?fields=spend,actions,campaign_name&level=campaign`
        + `&filtering=[{"field":"campaign.name","operator":"CONTAIN","value":"CHB"}]`
        + `&time_range={"since":"${since}","until":"${until}"}`
        + `&access_token=${META_TOKEN}`;
      const fallRes  = await fetch(fallUrl);
      const fallJson = await fallRes.json();
      if (!fallJson.error) {
        (fallJson.data || []).forEach(row => {
          spend    += parseFloat(row.spend || 0);
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
