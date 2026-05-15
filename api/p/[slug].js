const SUPABASE_URL  = 'https://dbijmgqlcrgjlcfrastg.supabase.co'
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRiaWptZ3FsY3JnamxjZnJhc3RnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNzYxNjMsImV4cCI6MjA4ODY1MjE2M30.mV2rANZ8Nb_AbifTmkEvdfX_nsm8zeT6Al_bPrCzNAA'

export default async function handler(req, res) {
  const { slug } = req.query
  if (!slug) { res.status(400).send('Slug ausente'); return }

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/propostas_comerciais?slug=eq.${encodeURIComponent(slug)}&select=storage_url,status,contato_nome`,
    { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } }
  )
  const data = await r.json()
  if (!data?.length || !data[0].storage_url) {
    res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8').send('<h2>Proposta não encontrada.</h2>')
    return
  }
  if (data[0].status === 'expirada') {
    res.status(410).setHeader('Content-Type', 'text/html; charset=utf-8').send('<h2>Esta proposta expirou.</h2>')
    return
  }
  const html = await fetch(data[0].storage_url).then(r => r.text())
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 's-maxage=3600')
  res.send(html)
}
