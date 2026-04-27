/* ============================================================
   script-historia.js
   Lógica exclusiva da página historia.html
   Depende de: i18next, script-shared.js, data.js
   ============================================================ */

dataReady.then(() => { /* espera os dados do json serem carregados */

  function renderHistoria() {
    const lang = i18next.language;
    const d    = historiaData;

    /* ── MANIFESTO ── */
    document.querySelector('.historia-manifesto__eyebrow').textContent =
      lang === 'en' ? d.manifesto.eyebrowEn : d.manifesto.eyebrow;

    document.querySelector('.historia-manifesto__title').innerHTML = `
      ${escHtml(lang === 'en' ? d.manifesto.title1En : d.manifesto.title1)}<br>
      <em>${escHtml(lang === 'en' ? d.manifesto.title2En : d.manifesto.title2)}</em>`;

    const [p1, p2] = document.querySelectorAll('.historia-manifesto__body p');
    p1.textContent = lang === 'en' ? d.manifesto.p1En : d.manifesto.p1;
    p2.textContent = lang === 'en' ? d.manifesto.p2En : d.manifesto.p2;

  
    /* ── FESTIVAIS ── */
    const festivais = d.festivais || [];
    document.getElementById('festivaisDivider').style.display  = festivais.length ? '' : 'none';
    document.getElementById('festivaisSection').style.display  = festivais.length ? '' : 'none';
    const festivaisFillerCount = (() => {
      let units = 0;
      festivais.forEach((_, i) => { units += (i % 5 === 0 || i % 5 === 3) ? 2 : 1; });
      const rem = units % 6;
      return rem === 0 ? 0 : 6 - rem;
    })();
    document.querySelector('.historia-festivais__grid').innerHTML =
      festivais.map(f => `
        <div class="historia-festival">
          ${f.logo ? `<img src="${f.logo}" alt="${escHtml(f.name)}">` : ''}
          <span class="historia-festival__name">${escHtml(f.name)}</span>
          ${f.year ? `<span class="historia-festival__year">${escHtml(f.year)}</span>` : ''}
        </div>`
      ).join('') +
      '<div class="historia-festival historia-festival--filler"></div>'.repeat(festivaisFillerCount);

    /* ── PARCEIROS ── */
    const parceiros = d.parceiros || [];
    document.querySelector('.historia-parceiros__grid').innerHTML =
      parceiros.map(p => {
        const name = typeof p === 'string' ? p : (p.name || '');
        const logo = typeof p === 'object' && p.logo ? p.logo : '';
        return logo
          ? `<div class="historia-parceiro"><img src="${logo}" alt="${escHtml(name)}" class="parceiro-logo-img" loading="lazy"></div>`
          : `<div class="historia-parceiro">${escHtml(name)}</div>`;
      }).join('');
    updateParceirosFiller(parceiros.length);

    observeReveal(0.15);
  }

  /* ── PARCEIROS: fillers responsivos ── */
  function parceirosCols() {
    return window.innerWidth <= 480 ? 1 : window.innerWidth <= 1024 ? 2 : 3;
  }
  function updateParceirosFiller(count) {
    const grid = document.querySelector('.historia-parceiros__grid');
    if (!grid) return;
    grid.querySelectorAll('.historia-parceiro--filler').forEach(el => el.remove());
    const cols = parceirosCols();
    const rem  = count % cols;
    const n    = rem === 0 ? 0 : cols - rem;
    for (let i = 0; i < n; i++) {
      const div = document.createElement('div');
      div.className = 'historia-parceiro historia-parceiro--filler';
      grid.appendChild(div);
    }
  }
  let _parceirosResizeTimer;
  function _parceirosResizeHandler() {
    clearTimeout(_parceirosResizeTimer);
    _parceirosResizeTimer = setTimeout(() => {
      const grid = document.querySelector('.historia-parceiros__grid');
      if (!grid) return;
      const count = grid.querySelectorAll('.historia-parceiro:not(.historia-parceiro--filler)').length;
      updateParceirosFiller(count);
    }, 120);
  }
  // Q1 — usa referência nomeada para evitar listeners duplicados ao trocar idioma
  window.removeEventListener('resize', _parceirosResizeHandler);
  window.addEventListener('resize', _parceirosResizeHandler);

  /* ── updateDOM (chamada pelo script-shared ao trocar idioma) ── */
  window.updateDOM = function() {
    applyI18n();
    renderHistoria();
  }

  /* ── i18next ── */
  i18next.init({
    lng: localStorage.getItem('lang') || 'pt',
    resources: {
      pt: {
        translation: {
          ...COMMON_I18N.pt,
          'nav.portfolio':          'Portfólio',
          'historia.festivais.eyebrow':  (pagesData.historia && pagesData.historia.festivaisEyebrowPt) || 'Festivais',
          'historia.parceiros.eyebrow': (pagesData.historia && pagesData.historia.parceirosEyebrowPt)  || 'Parceiros',
        }
      },
      en: {
        translation: {
          ...COMMON_I18N.en,
          'nav.portfolio':          'Portfolio',
          'historia.festivais.eyebrow':  (pagesData.historia && pagesData.historia.festivaisEyebrowEn) || 'Film Festivals',
          'historia.parceiros.eyebrow': (pagesData.historia && pagesData.historia.parceirosEyebrowEn)  || 'Partners',
        }
      }
    }
  }, () => {
    renderHistoria();
  });
});