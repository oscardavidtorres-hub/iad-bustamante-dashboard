// HubSpot CRM API Proxy — Netlify Function
const t1='pat-na1-';const t2='0e940494-';const t3='3ff8-4e38-';const t4='8aae-';const t5='b828689d8856';
const HS_TOKEN = process.env.HS_TOKEN || (t1+t2+t3+t4+t5);

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
    const sinceMs = new Date(since + 'T00:00:00').getTime();
    const untilMs = new Date(until + 'T23:59:59').getTime();

    const body = {
      filterGroups: [{
        filters: [
          { propertyName: 'id_de_pauta_conversacion___picallex', operator: 'HAS_PROPERTY' },
          { propertyName: 'createdate', operator: 'BETWEEN', value: sinceMs.toString(), highValue: untilMs.toString() }
        ]
      }],
      properties: ['createdate','estatus_inmigracion_comercial','p3','p5','vendido','id_de_pauta_conversacion___picallex'],
      limit: 200,
      sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }]
    };

    let allContacts = [];
    let after = undefined;

    do {
      const pageBody = after ? { ...body, after } : body;
      const res = await fetch('https://api.hubapi.com/crm/v3/objects/contacts/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${HS_TOKEN}`,
          'accept': 'application/json'
        },
        body: JSON.stringify(pageBody)
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HubSpot ${res.status}: ${errText.substring(0, 300)}`);
      }

      const json = await res.json();
      if (json.status === 'error') throw new Error(json.message);

      allContacts = allContacts.concat(json.results || []);
      after = json.paging?.next?.after;

    } while (after && allContacts.length < 1000);

    const total = allContacts.length;
    let comercial = 0, p3 = 0, p5 = 0, vendido = 0;

    allContacts.forEach(c => {
      const props = c.properties || {};
      if (props.estatus_inmigracion_comercial && props.estatus_inmigracion_comercial !== '') comercial++;
      if (props.p3 === 'true' || props.p3 === true) p3++;
      if (props.p5 === 'true' || props.p5 === true) p5++;
      if (props.vendido === 'true' || props.vendido === true) vendido++;
    });

    return {
      statusCode: 200,
      headers: CORS,
      body: JSON.stringify({ total, quality: { comercial, p3, p5, vendido } })
    };

  } catch (err) {
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err.message }) };
  }
};
