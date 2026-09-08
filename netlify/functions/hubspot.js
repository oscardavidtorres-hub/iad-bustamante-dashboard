// HubSpot CRM API Proxy — Netlify Function
// El token vive solo en las variables de entorno del sitio (HS_Token / HS_TOKEN).
const HS_TOKEN = process.env.HS_TOKEN || process.env.HS_Token || '';

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

// Valores que PicallEx ha escrito en "Record source detail 1".
// La integración cambió la etiqueta a mitad de camino: desde finales de agosto de
// 2026 los contactos llegan como "PicallEx Integration", así que hay que aceptar
// ambos valores o se pierden todos los contactos recientes.
const PICALLEX_SOURCES = [
  'PicallEx App Integration-Application',
  'PicallEx Integration'
];

// Filtros base — Group 2 de HubSpot
// 1. ID de Pauta Conversación - Picallex is known
// 2. Record source detail 1 = cualquiera de los orígenes PicallEx
// + createdate dentro del rango seleccionado
const BASE_FILTERS = [
  { propertyName: 'id_de_pauta_conversacion__picallex', operator: 'HAS_PROPERTY' },
  { propertyName: 'hs_object_source_detail_1', operator: 'IN', values: PICALLEX_SOURCES }
];

// Topes de seguridad de la paginación (HubSpot Search entrega 200 por página y
// limita a ~5 req/s, así que un rango muy largo no cabe en el tiempo de ejecución
// de la función). Al agotarse el presupuesto se devuelve lo obtenido con
// truncated: true en vez de dejar que la función expire.
const MAX_CONTACTS   = 10000;
const TIME_BUDGET_MS = 7000;

async function searchContacts(extraFilters = [], limit = 200, after = undefined) {
  const body = {
    filterGroups: [{
      filters: [...BASE_FILTERS, ...extraFilters]
    }],
    properties: ['createdate', 'inmigration_status'],
    limit,
    sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }]
  };
  if (after) body.after = after;

  // La Search API de HubSpot limita a ~5 req/s y recorrer un rango largo se acerca
  // a ese tope, así que un 429 se reintenta con espera creciente.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${HS_TOKEN}`,
        'accept': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (res.status === 429 && attempt < 3) {
      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      continue;
    }

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`HubSpot ${res.status}: ${txt.substring(0, 400)}`);
    }

    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message);
    return json;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: CORS, body: '' };

  const { since, until } = event.queryStringParameters || {};
  if (!since || !until) return { statusCode: 400, headers: CORS, body: JSON.stringify({ error: 'Faltan parámetros' }) };
  if (!HS_TOKEN) return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: 'Falta la variable de entorno HS_Token' }) };

  try {
    const sinceMs = new Date(since + 'T00:00:00').getTime();
    const untilMs = new Date(until + 'T23:59:59').getTime();

    // Filtros de fecha para el rango seleccionado
    const dateFilters = [
      { propertyName: 'createdate', operator: 'GTE', value: String(sinceMs) },
      { propertyName: 'createdate', operator: 'LTE', value: String(untilMs) }
    ];

    // Obtener TODOS los contactos del rango con paginación
    const deadline = Date.now() + TIME_BUDGET_MS;
    let allContacts = [];
    let after = undefined;

    do {
      const json = await searchContacts(dateFilters, 200, after);
      allContacts = allContacts.concat(json.results || []);
      after = json.paging?.next?.after;
    } while (after && allContacts.length < MAX_CONTACTS && Date.now() < deadline);

    const truncated = Boolean(after);

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
        truncated,   // true = el rango es tan largo que quedaron contactos sin leer
        quality: { comercial, p3, p5, vendido },
        byDay
      })
    };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
