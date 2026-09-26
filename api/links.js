import { rpc, selectAll } from '../lib/supabase.js';

const FIELDS = ['url', 'source', 'medium', 'campaign', 'term', 'content', 'note'];
const clean = b => Object.fromEntries(FIELDS.map(k => [k, String(b?.[k] ?? '').trim().slice(0, 500)]));

// UTMs guardadas desde el constructor
// GET    /api/links            → lista
// POST   /api/links            → crear  { url, source, medium, campaign, term?, content?, note? }
// PUT    /api/links?id=…       → editar
// DELETE /api/links?id=…       → eliminar
export default async function handler(req, res) {
  try {
    if (req.method === 'GET') return res.status(200).json(await selectAll('utm_links', 'select=*&order=updated_at.desc'));
    const secret = process.env.SYNC_SECRET, id = req.query.id;
    if (req.method === 'DELETE') {
      if (!id) throw new Error('Falta id');
      return res.status(200).json({ ok: await rpc('utm_link_delete', { p_secret: secret, p_id: id }) });
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const row = clean(req.body);
      if (!row.url || !row.source || !row.medium || !row.campaign) throw new Error('URL, fuente, medio y campaña son obligatorios');
      if (req.method === 'PUT') { if (!id) throw new Error('Falta id'); row.id = id; }
      return res.status(200).json(await rpc('utm_link_save', { p_secret: secret, p_row: row }));
    }
    res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
