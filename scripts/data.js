/* ============================================================
   data.js
   Carrega data.json e expõe as variáveis globais usadas
   pelos demais scripts: films, upcomingFilms, historiaData.

   IMPORTANTE: este script usa fetch(), portanto o site precisa
   rodar em um servidor HTTP (local ou produção).
   Para desenvolvimento local, use: npx serve . ou Live Server.
   ============================================================ */

/* Promessa global resolvida quando os dados estiverem prontos.
   Os scripts de página devem aguardar: await dataReady          */
let films            = [];
let upcomingFilms    = [];
let historiaData     = {};
let otherProductions = [];
let pagesData        = {};
let siteData         = {};

const dataReady = fetch('scripts/data.json')
  .then(res => {
    if (!res.ok) throw new Error(`Erro ao carregar data.json: ${res.status}`);
    return res.json();
  })
  .then(json => {
    films            = json.films;
    upcomingFilms    = json.upcomingFilms;
    historiaData     = json.historiaData;
    otherProductions = json.otherProductions || [];
    pagesData        = json.pagesData        || {};
    siteData         = json.siteData         || {};
  })
  .catch(err => {
    console.error('[pontos de fuga] Falha ao carregar dados:', err);
    // Exibe mensagem de erro visível para o usuário em páginas públicas.
    // O admin tem tratamento próprio — só aplica se houver .page ou main no DOM.
    const target = document.querySelector('.page, main, .filme-page');
    if (target && !document.getElementById('app')) {
      target.innerHTML =
        '<div style="padding:120px 48px;display:flex;flex-direction:column;gap:16px;max-width:480px">' +
        '<p style="font-family:monospace;font-size:0.8rem;opacity:0.5">Erro ao carregar o catálogo.</p>' +
        '<p style="font-size:0.85rem;opacity:0.4;line-height:1.6">Verifique sua conexão ou tente novamente.</p>' +
        '<button onclick="location.reload()" style="font-family:monospace;font-size:0.75rem;letter-spacing:0.1em;text-transform:uppercase;background:none;border:1px solid rgba(240,236,228,0.25);color:inherit;padding:8px 16px;cursor:pointer;width:fit-content">Recarregar</button>' +
        '</div>';
    }
    throw err; // re-throw para que páginas possam capturar via .catch() se necessário
  });