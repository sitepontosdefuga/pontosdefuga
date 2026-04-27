/* ============================================================
   script-vemai.js
   Lógica exclusiva da página vemai.html
   Depende de: i18next, script-shared.js (upcomingFilms)
   ============================================================ */

dataReady.then(() => { /* espera os dados do json serem carregados */

  /* ── RENDERIZA FILMES ── */

  function renderFilmes() {
    const lang = i18next.language;

    const html = upcomingFilms.map((f, i) => {
      const title    = lang === 'en' ? f.titleEn    : f.title;
      const synopsis = lang === 'en' ? f.synopsisEn : f.synopsis;
      const genre    = lang === 'en' ? f.genreEn    : f.genre;
      const status   = i18next.t(statusKey[f.status]);

      return `
        <a href="filme.html?src=upcoming&i=${i}" class="vemai-filme reveal">
          <div class="vemai-filme__img-wrap">
            <div class="vemai-filme__img-bg"></div>
            ${placeholderSVG(64, 0.6, 'vemai-filme__placeholder')}
            ${f.imgPortrait
              ? `<img class="vemai-filme__img" src="${f.imgPortrait}" alt="${title}" onerror="this.style.display='none'">`
              : ''}
          </div>
          <div class="vemai-filme__info">
            <div class="vemai-filme__status">${escHtml(status)}</div>
            <h2 class="vemai-filme__title">${escHtml(title)}</h2>
            <div class="vemai-filme__meta">
              ${escHtml(genre)} &nbsp;·&nbsp; ${escHtml(f.year)}
            </div>
            <p class="vemai-filme__synopsis">${escHtml(synopsis)}</p>
            <div class="vemai-filme__tags">
              <span class="vemai-filme__tag">${escHtml(genre)}</span>
              <span class="vemai-filme__tag">${escHtml(f.year)}</span>
              <span class="vemai-filme__tag">${escHtml(status)}</span>
            </div>
          </div>
        </a>`;
    }).join('');

    document.getElementById('vemai-filmes').innerHTML = html;
    observeReveal();
  }

  /* ── updateDOM (chamada pelo script-shared ao trocar idioma) ── */
  function updateStatement() {
    const el = document.getElementById('vemaiStatement');
    if (!el) return;
    const lang = i18next.language;
    const v = pagesData.vemai || {};
    const text = lang === 'en' ? v.statementEn : v.statementPt;
    if (text) el.textContent = text;
  }

  window.updateDOM = function() {
    applyI18n();
    updateStatement();
    renderFilmes();
  }


  /* ── i18next ── */
  i18next.init({
    lng: localStorage.getItem('lang') || 'pt',
    resources: {
      pt: {
        translation: {
          ...COMMON_I18N.pt,
          'nav.portfolio':          'Portfólio',
          'nav.shop':               'Loja',
          'vemai.eyebrow':          (pagesData.vemai && pagesData.vemai.eyebrowPt) || 'Em produção',
          'vemai.title':            (pagesData.vemai && pagesData.vemai.titlePt)   || 'Vem aí',
          'vemai.sub':              (pagesData.vemai && pagesData.vemai.subPt)     || 'Cada projeto nasce de uma inquietação — uma pergunta que não cabe em silêncio. Aqui vivem as histórias que ainda estão tomando forma.',
          'status.filming':         'Filmando',
          'status.dev':             'Desenvolvimento',
          'status.post':            'Pós-produção',
          'footer.col2':            'Mais',
        }
      },
      en: {
        translation: {
          ...COMMON_I18N.en,
          'nav.portfolio':          'Portfolio',
          'nav.shop':               'Shop',
          'vemai.eyebrow':          (pagesData.vemai && pagesData.vemai.eyebrowEn) || 'In production',
          'vemai.title':            (pagesData.vemai && pagesData.vemai.titleEn)   || 'Coming soon',
          "vemai.sub":              (pagesData.vemai && pagesData.vemai.subEn)     || "Each project is born from a restlessness — a question that doesn't fit in silence. Here live the stories still taking shape.",
          'status.filming':         'Filming',
          'status.dev':             'Development',
          'status.post':            'Post-production',
          'footer.col2':            'More',
        }
      }
    }
  }, () => {
    applyI18n();
    updateStatement();
    renderFilmes();
    observeReveal();
  });
});