# IAD & Bustamante — Performance Dashboard

Dashboard de performance para campaña WhatsApp de IAD & Bustamante.

## Stack
- **Meta Ads API** → Campaña: `(CHB) IAD - WhatsApp - ESTADOS` · Cuenta: `2702947393233872`
- **HubSpot CRM API** → Filtro: ID Pauta Picallex conocido + createdate en rango

## Deploy en Netlify

### Opción A — Netlify Drop (más rápido)
1. Abre [app.netlify.com/drop](https://app.netlify.com/drop)
2. Arrastra la carpeta completa
3. Listo ✅

### Opción B — GitHub + Netlify (recomendado para actualizaciones)

**1. Subir a GitHub:**
```bash
git init
git add .
git commit -m "feat: IAD Bustamante dashboard"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/iad-bustamante-dashboard.git
git push -u origin main
```

**2. Conectar en Netlify:**
- Ir a [app.netlify.com](https://app.netlify.com) → "Add new site" → "Import from Git"
- Seleccionar el repo
- Build settings: dejar todo vacío (es HTML estático)
- Publish directory: `.`
- Deploy ✅

## Archivos
- `index.html` — Dashboard completo con tokens integrados
- `netlify.toml` — Headers CORS para que las APIs funcionen desde el browser
