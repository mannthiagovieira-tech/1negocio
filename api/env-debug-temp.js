// TEMP · deletar após diagnosticar. Retorna hash md5 das envs, nunca o valor.
const crypto = require('crypto');
function h(v){ return v ? crypto.createHash('md5').update(v).digest('hex').slice(0,10) : 'undefined'; }
module.exports = (req, res) => {
  res.setHeader('Cache-Control','no-store');
  res.status(200).json({
    ok: true,
    CRON_SECRET: h(process.env.CRON_SECRET),
    ZAPI_WEBHOOK_TOKEN: h(process.env.ZAPI_WEBHOOK_TOKEN),
    KIPFLOW_API_KEY: h(process.env.KIPFLOW_API_KEY),
    SUPABASE_SERVICE_ROLE_KEY: h(process.env.SUPABASE_SERVICE_ROLE_KEY),
    ANTHROPIC_API_KEY: h(process.env.ANTHROPIC_API_KEY),
    lengths: {
      CRON_SECRET: (process.env.CRON_SECRET||'').length,
      ZAPI_WEBHOOK_TOKEN: (process.env.ZAPI_WEBHOOK_TOKEN||'').length,
    },
  });
};
