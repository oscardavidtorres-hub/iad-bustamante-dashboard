// Meta Ads API Proxy — Netlify Function
// El token vive solo en las variables de entorno del sitio (Meta_token / META_TOKEN).
const META_TOKEN = process.env.META_TOKEN || process.env.Meta_token || '';
const ACCOUNT_ID = '2702947393233872';
const API = 'https://graph.facebook.com/v19.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

// Nombre de campaña objetivo: (CHB) IAD - WhatsApp - ESTADOS
// La cuenta tiene varias campañas que empiezan por "(CHB) IAD" (FORM, FORM ELIANA, ...)
// y varias con el mismo nombre de WhatsApp, así que se agregan TODAS las que coincidan.
const MATCH_ALL      = ['chb', 'iad', 'whatsapp'];
const MATCH_FALLBACK = ['chb', 'iad'];

const MSG_ACTIONS = [
  'onsite_conversion.messaging_conversation_started_7d',
  'messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection'
];

async function graph(path, params) {
  const qs = new URLSearchParams({ ...params, access_token: META_TOKEN });
  const res  = await fetch(`${API}/${path}?${qs}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

// Todas las campañas de la cuenta (con paginación)
async function getCampaigns() {
  let all = [], after;
  do {
    const json = await graph(`act_${ACCOUNT_ID}/campaigns`, {
      fields: 'id,name,status',
      limit: 200,
      ...(after ? { after } : {})
    });
    all = all.concat(json.data || []);
    after = json.paging?.cursors?.after && json.paging?.next ? json.paging.cursors.after : undefined;
  } while (after && all.length < 1000);
  return all;
}

function matchCampaigns(campaigns, words) {
  return campaigns.filter(c => {
    const name = (c.name || '').toLowerCase();
    return words.every(w => name.includes(w));
  });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const { since, until } = event.queryStringParameters || {};
  if (!since || !until) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Faltan parámetros since/until' }) };
  if (!META_TOKEN) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Falta la variable de entorno Meta_token' }) };

  try {
    const campaigns = await getCampaigns();
    let matched = matchCampaigns(campaigns, MATCH_ALL);
    if (!matched.length) matched = matchCampaigns(campaigns, MATCH_FALLBACK);

    if (!matched.length) {
      return {
        statusCode: 200,
        headers: CORS,
        body: JSON.stringify({ spend: 0, messages: 0, trend: [], adsets: [], campaign: 'No encontrada' })
      };
    }

    const ids = matched.map(c => c.id);
    // Se consulta a nivel de cuenta filtrando por los ids encontrados: así los
    // totales quedan agregados sobre todas las campañas que coinciden.
    const scope = {
      time_range: JSON.stringify({ since, until }),
      filtering: JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: ids }])
    };

    const [totalsJson, dailyJson, adsetJson] = await Promise.all([
      graph(`act_${ACCOUNT_ID}/insights`, { ...scope, fields: 'spend,impressions,reach,actions' }),
      graph(`act_${ACCOUNT_ID}/insights`, { ...scope, fields: 'spend,impressions,reach,actions', time_increment: 1, limit: 500 }),
      graph(`act_${ACCOUNT_ID}/insights`, { ...scope, fields: 'adset_id,adset_name,spend,actions', level: 'adset', limit: 500 })
    ]);

    const totals  = (totalsJson.data || [])[0] || {};
    const spend    = parseFloat(totals.spend || 0);
    const messages = extractAction(totals.actions);

    const trend = (dailyJson.data || [])
      .map(row => ({
        date:        row.date_start,
        msgs:        extractAction(row.actions),
        spend:       parseFloat(row.spend       || 0),
        impressions: parseInt(row.impressions   || 0),
        reach:       parseInt(row.reach         || 0)
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const rows = (adsetJson.data || []).map(a => ({
      id:    a.adset_id,
      name:  a.adset_name,
      msgs:  extractAction(a.actions),
      spend: parseFloat(a.spend || 0)
    })).sort((a, b) => b.msgs - a.msgs).slice(0, 5);

    const statuses = await getAdsetStatuses(rows.map(r => r.id));
    const adsets = rows.map(r => ({
      name:   r.name,
      msgs:   r.msgs,
      spend:  r.spend,
      status: statuses[r.id] === 'ACTIVE' ? 'ACTIVE' : (statuses[r.id] ? 'PAUSED' : 'ACTIVE')
    }));

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        spend,
        messages,
        trend,
        adsets,
        campaign: [...new Set(matched.map(c => c.name))].join(' + ')
      })
    };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};

// Estado real de los adsets mostrados (el badge de la tabla)
async function getAdsetStatuses(ids) {
  const clean = ids.filter(Boolean);
  if (!clean.length) return {};
  try {
    const json = await graph('', { ids: clean.join(','), fields: 'effective_status' });
    return Object.fromEntries(Object.entries(json).map(([id, v]) => [id, v.effective_status]));
  } catch {
    return {};
  }
}

// Primer tipo de acción de mensajería con valor
function extractAction(actions) {
  if (!actions) return 0;
  for (const type of MSG_ACTIONS) {
    const found = actions.find(a => a.action_type === type);
    if (found) return parseInt(found.value) || 0;
  }
  return 0;
}
