// Generates public/sitemap.xml from the live directory (all publicly-visible
// salons + static pages). Re-run after seeding new salons:  node scripts/gen-sitemap.mjs
import fs from 'fs';
const BASE = 'https://glowupbook.com';
const SUPA = 'https://doeswhjbbvyxupusulsv.supabase.co';
const KEY = 'sb_publishable_axNd-CdOPzNzkrb1lvKxhw_vhraBCOs';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };

// Anon RLS already limits rows to publicly-visible salons (published OR unclaimed).
async function allSlugs() {
  const out = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    // Order by a UNIQUE column (slug) so offset pagination is stable — ordering
    // by updated_at (many ties from the bulk seed) skips/repeats rows.
    const url = `${SUPA}/rest/v1/salons?select=slug,updated_at&order=slug.asc&limit=${page}&offset=${offset}`;
    const res = await fetch(url, { headers: H });
    if (!res.ok) throw new Error('fetch failed ' + res.status + ' ' + await res.text());
    const rows = await res.json();
    out.push(...rows);
    process.stdout.write(`\rfetched ${out.length}`);
    if (rows.length < page) break;
  }
  process.stdout.write('\n');
  return out;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const staticPages = [
  { loc: '/', pri: '1.0', freq: 'daily' },
  { loc: '/terms', pri: '0.3', freq: 'yearly' },
  { loc: '/privacy', pri: '0.3', freq: 'yearly' },
];

const rows = await allSlugs();
const seen = new Set();
const urls = [];
for (const p of staticPages) urls.push(`  <url><loc>${BASE}${p.loc}</loc><changefreq>${p.freq}</changefreq><priority>${p.pri}</priority></url>`);
for (const r of rows) {
  if (!r.slug || seen.has(r.slug)) continue; seen.add(r.slug);
  const lastmod = r.updated_at ? String(r.updated_at).slice(0, 10) : null;
  urls.push(`  <url><loc>${BASE}/${esc(encodeURIComponent(r.slug))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}<changefreq>weekly</changefreq><priority>0.7</priority></url>`);
}
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`;
fs.writeFileSync('C:/Users/edios/Documents/GitHub/salon-crm/public/sitemap.xml', xml, 'utf8');
console.log(`wrote public/sitemap.xml — ${urls.length} URLs (${(Buffer.byteLength(xml)/1024/1024).toFixed(2)} MB)`);
