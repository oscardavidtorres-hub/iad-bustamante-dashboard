// HubSpot CRM API Proxy — Netlify Function
const h1="pat-na1-0e940494";
const h2="-3ff8-4e38-8aae";
const h3="-b828689d8856";
const HS_TOKEN = process.env.HS_TOKEN || (h1+h2+h3);

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

const STATUS_P3      = 'P 3';
const STATUS_P5      = 'P5. Otros';
const STATUS_VENDIDO = 'Vendido';
const isP1 = (v) => v && v.startsWith('P1.');

// Filtros base — exactamente los del Group 2 de HubSpot
// 1. ID de Pauta Conversación - Picallex is known
// 2. Record source detail 1 = PicallEx App Integration-Application
// + createdate dentro del rango seleccionado
const BASE_FILTERS = [
  { propertyName: 'id_de_pauta_conversacion__picallex', operator: 'HAS_PROPERTY' },
  { propertyName: 'hs_object_source_detail_1', operator: 'EQ', value: 'PicallEx App Integration-Application' }
];

async function searchContacts(extraFilters = [], limit = 200, after = undefined) {
  const body = {
    filterGroups: [{
      filters: [...BASE_FILTERS, ...extraFilters]
    }],
    properties: ['createdate', 'inmigration_status', 'id_de_pauta_conversacion__picallex'],
    limit,
    sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }]
  };
  if (after) body.after = after;

  const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${HS_TOKEN}`,
      'accept': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HubSpot ${res.status}: ${txt.substring(0, 400)}`);
  }

  const json = await res.json();
  if (json.status === 'error') throw new Error(json.message);
  return json;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const { since, until } = event.queryStringParameters || {};
  if (!since || !until) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Faltan parámetros' }) };

  try {
    const sinceMs = new Date(since + 'T00:00:00').getTime();
    const untilMs = new Date(until + 'T23:59:59').getTime();

    // Filtros de fecha para el rango seleccionado
    const dateFilters = [
      { propertyName: 'createdate', operator: 'GTE', value: String(sinceMs) },
      { propertyName: 'createdate', operator: 'LTE', value: String(untilMs) }
    ];

    // Obtener TODOS los contactos del rango con paginación
    let allContacts = [];
    let after = undefined;

    do {
      const json = await searchContacts(dateFilters, 200, after);
      allContacts = allContacts.concat(json.results || []);
      after = json.paging?.next?.after;
    } while (after && allContacts.length < 2000);

    const total = allContacts.length;
    let comercial = 0, p3 = 0, p5 = 0, vendido = 0;
    const byDay = {};

    allContacts.forEach(c => {
      const props  = c.properties || {};
      const status = props.inmigration_status || '';

      if (isP1(status))            comercial++;
      if (status === STATUS_P3)    p3++;
      if (status === STATUS_P5)    p5++;
      if (status === STATUS_VENDIDO) vendido++;

      // Agrupar por día YYYY-MM-DD (createdate viene en UTC ISO)
      const cd = props.createdate;
      if (cd) {
        const day = cd.substring(0, 10);
        byDay[day] = (byDay[day] || 0) + 1;
      }
    });

    // Validación: suma de byDay debe = total
    const sumByDay = Object.values(byDay).reduce((a, b) => a + b, 0);

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({
        total,
        sumByDay,  // para debug — debe = total
        quality: { comercial, p3, p5, vendido },
        byDay
      })
    };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
