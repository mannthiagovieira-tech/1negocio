import { ImageResponse } from '@vercel/og';
import { writeFile } from 'fs/promises';

const T = { ink:'#0A0A0A', ink3:'#4B5563', paper:'#FAFAFA', accent:'#16a34a', logo:'1Negócio' };
function tam(f) {
  if (f === 'feed_1080') return { w:1080, h:1080 };
  if (f === 'story_1080x1920') return { w:1080, h:1920 };
  return { w:1200, h:628 };
}
async function loadFonts() {
  const get = async u => { try { const r = await fetch(u); if (r.ok) return await r.arrayBuffer(); } catch {} return null; };
  const [geist, syne, mono] = await Promise.all([
    get('https://cdn.jsdelivr.net/gh/vercel/geist-font@1/fonts/geist-sans/Geist-Regular.otf'),
    get('https://cdn.jsdelivr.net/npm/@fontsource/syne@5/files/syne-latin-800-normal.woff'),
    get('https://cdn.jsdelivr.net/npm/@fontsource/jetbrains-mono@5/files/jetbrains-mono-latin-500-normal.woff'),
  ]);
  const out = [];
  if (geist) out.push({ name:'Geist', data:geist, weight:400, style:'normal' });
  if (syne)  out.push({ name:'Syne',  data:syne,  weight:800, style:'normal' });
  if (mono)  out.push({ name:'JetBrains Mono', data:mono, weight:500, style:'normal' });
  return out;
}
function tree(layout, formato, c) {
  const { w, h } = tam(formato);
  const pad = Math.round(w * 0.06);
  const topbar = { type:'div', key:'top', props:{
    style:{ display:'flex', alignItems:'center', gap:12, fontFamily:'JetBrains Mono', fontSize:Math.round(w*0.018), color:T.ink3, letterSpacing:2, textTransform:'uppercase' },
    children:[
      { type:'div', key:'bar', props:{ style:{ width:24, height:4, background:T.accent } } },
      { type:'span', key:'lg',  props:{ children:T.logo } },
      { type:'span', key:'sub', props:{ style:{ opacity:0.4 }, children:'· venda assessorada de PME' } },
    ],
  }};
  const cta = { type:'div', key:'cta', props:{
    style:{ display:'flex', alignItems:'center', gap:16, fontFamily:'Geist', fontSize:Math.round(w*0.025) },
    children:[
      { type:'div', key:'btn', props:{ style:{ padding:'14px 26px', background:T.accent, color:'#fff', borderRadius:999, fontWeight:600 }, children:c.cta } },
      { type:'span', key:'url', props:{ style:{ color:T.ink3 }, children:'1negocio.com.br' } },
    ],
  }};
  let miolo;
  if (layout === 'tipografico_a') {
    miolo = { type:'div', key:'a', props:{
      style:{ display:'flex', flexDirection:'column', gap:20, flex:1, justifyContent:'center' },
      children:[
        { type:'div', key:'hl', props:{ style:{ fontFamily:'Syne', fontSize:Math.round(w*0.078), fontWeight:800, lineHeight:1.05, letterSpacing:-1 }, children:c.headline } },
        { type:'div', key:'tx', props:{ style:{ fontSize:Math.round(w*0.028), color:T.ink3, lineHeight:1.4, maxWidth:w-pad*2 }, children:c.texto } },
      ],
    }};
  } else if (layout === 'tipografico_b') {
    miolo = { type:'div', key:'b', props:{
      style:{ display:'flex', flexDirection:'column', gap:24, flex:1, justifyContent:'center' },
      children:[
        { type:'div', key:'tx', props:{ style:{ fontSize:Math.round(w*0.024), color:T.ink3, lineHeight:1.4, maxWidth:w-pad*2, borderLeft:`4px solid ${T.accent}`, paddingLeft:16 }, children:c.texto } },
        { type:'div', key:'hl', props:{ style:{ fontFamily:'Syne', fontSize:Math.round(w*0.062), fontWeight:800, lineHeight:1.05, letterSpacing:-1 }, children:c.headline } },
      ],
    }};
  } else {
    const m = c.headline.match(/(R\$\s*[\d.\-–\s]+M?|[\d.]+×|\d+%)/);
    const dado = m?.[0]?.trim() || c.headline.split(' ').slice(0,3).join(' ');
    const resto = c.headline.replace(dado, '').trim();
    // Formato link (1200×628) tem H baixinho · escala pelo min(W, H*1.7) evita overflow
    const escala = Math.min(w, h * 1.7);
    miolo = { type:'div', key:'c', props:{
      style:{ display:'flex', flexDirection:'column', alignItems:'center', gap:8, flex:1, justifyContent:'center' },
      children:[
        { type:'div', key:'n', props:{ style:{ fontFamily:'Syne', fontSize:Math.round(escala*0.14), fontWeight:800, lineHeight:0.95, color:T.accent, letterSpacing:-2, whiteSpace:'nowrap' }, children:dado } },
        { type:'div', key:'l', props:{ style:{ fontFamily:'Syne', fontSize:Math.round(escala*0.036), fontWeight:800, textAlign:'center' }, children:resto || c.headline } },
        { type:'div', key:'t', props:{ style:{ fontSize:Math.round(escala*0.022), color:T.ink3, textAlign:'center', maxWidth:w*0.8, marginTop:8 }, children:c.texto } },
      ],
    }};
  }
  return { type:'div', key:'root', props:{
    style:{ width:w, height:h, display:'flex', flexDirection:'column', background:T.paper, color:T.ink, padding:pad, fontFamily:'Geist', justifyContent:'space-between' },
    children:[topbar, miolo, cta],
  }};
}

const CRIATIVOS = [
  { id:'96e668cf', formato:'feed_1080', layout:'tipografico_a',
    headline:'Indústria alimentícia no RJ · à venda com assessoria',
    texto:'Marca com décadas no varejo · EBITDA 20% · faixa R$ 2-3M · verticalize seu canal.',
    cta:'Quero saber' },
  { id:'b89cc534', formato:'story_1080x1920', layout:'tipografico_b',
    headline:'Verticalize sua distribuição.',
    texto:'Distribuidor no Grande Rio · aquisição de fábrica alimentar em operação · marca pronta · 40 PDVs ativos.',
    cta:'Falar agora' },
  { id:'f5d17dab', formato:'link_1200x628', layout:'dado_destaque',
    headline:'R$ 2-3M · fábrica alimentar RJ',
    texto:'Ativo em operação · EBITDA 20% · relacionamento pronto no varejo · assessoria de M&A.',
    cta:'Ver detalhes' },
];

const fonts = await loadFonts();
console.log('fontes carregadas:', fonts.map(f => f.name).join(', ') || '(nenhuma)');
for (const c of CRIATIVOS) {
  const { w, h } = tam(c.formato);
  const img = new ImageResponse(tree(c.layout, c.formato, c), { width:w, height:h, fonts });
  const png = Buffer.from(await img.arrayBuffer());
  const path = `/tmp/p5-criativo-${c.id}-${c.formato}.png`;
  await writeFile(path, png);
  console.log(`  ${c.formato} ${c.layout} → ${path} (${png.length} bytes)`);
}
