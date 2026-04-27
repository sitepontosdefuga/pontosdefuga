/* ============================================================
   script-producoes.js
   Lógica exclusiva da página producoes.html
   Depende de: i18next, script-shared.js
   ============================================================ */

dataReady.then(() => { /* espera os dados do json serem carregados */


  /* ── SORT BUTTONS (Recentes / A–Z) ── */
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const mode = btn.getAttribute('data-sort'); // 'recent' ou 'az'
      renderGrid(mode);
    });
  });

  /* ── PALETA HOVER DOS CARDS ── */
  let cardColorIdx = -1;

  function attachCardHovers() {
    document.querySelectorAll('.film-card').forEach(card => {
      card.addEventListener('mouseenter', () => {
        cardColorIdx = (cardColorIdx + 1) % PALETTE.length;
        const color = PALETTE[cardColorIdx];
        card.style.outline = `3px solid ${color}`;
        card.querySelector('.film-card__title').style.color = color;
        const video = card.querySelector('.film-card__video');
        if (video) { video.currentTime = 0; video.play(); }
      });
      card.addEventListener('mouseleave', () => {
        card.style.outline = '';
        card.querySelector('.film-card__title').style.color = '';
        const video = card.querySelector('.film-card__video');
        if (video) { video.pause(); video.currentTime = 0; }
      });
    });
  }

  /* ── CRIA CARD ── */
  function createCard(film, index) {
    const wide     = film.size === 'wide' ? 'card--wide' : '';
    const tall     = film.rows === 2      ? 'card--tall' : '';
    const title    = i18next.language === 'en' && film.titleEn ? film.titleEn : film.title;
    const hasVideo = !!film.videoHover;

    return `
      <a href="filme.html?i=${index}" class="film-card ${wide} ${tall} card--${film.ratio}${hasVideo ? ' card--has-video' : ''}">
        <div class="film-card__img">
          ${placeholderSVG()}
          <img class="img-portrait"
               src="${film.imgPortrait}"
               alt="${escHtml(title)}"
               loading="lazy"
               onerror="this.style.display='none'">
          ${hasVideo ? `<video class="film-card__video" src="${film.videoHover}" poster="${film.imgPortrait}" muted playsinline preload="none"></video>` : ''}
        </div>
        <div class="film-card__info">
          <div class="film-card__title">${escHtml(title)}</div>
          <div class="film-card__meta">
            <div class="film-card__dir">${film.director ? `Dir. ${escHtml(film.director)}` : ''}</div>
            <span class="film-card__year">${escHtml(film.year)}</span>
          </div>
        </div>
      </a>`;
  }

  /* ── RENDERIZA GRID (com ordenação) ── */

  function renderGrid(sortMode = 'relevance') {
    let sorted = [...films];

    if (sortMode === 'relevance') {
      // Preserva a ordem editorial do data.json (sem modificação)
    } else if (sortMode === 'recent') {
      sorted.sort((a, b) => b.year - a.year);
    } else if (sortMode === 'az') {
      const lang = i18next.language;
      sorted.sort((a, b) => {
        const titleA = lang === 'en' ? a.titleEn : a.title;
        const titleB = lang === 'en' ? b.titleEn : b.title;
        return titleA.localeCompare(titleB, lang, { sensitivity: 'base' });
      });
    }

    document.querySelector('.films-grid').innerHTML = sorted.map((film, i) => {
      const pattern       = i === 0 ? { size: 'wide', ratio: 'l', rows: 1 }
                                    : { size: '',     ratio: 'p', rows: 1 };
      const originalIndex = films.indexOf(film);
      return createCard({ ...film, ...pattern }, originalIndex);
    }).join('');

    attachCardHovers();
  }





  /* ── CRIA CARD PEQUENO (outras produções) ── */
  function createSmallCard(prod, index) {
    const title   = i18next.language === 'en' && prod.titleEn ? prod.titleEn : prod.title;
    const dirHtml = prod.director
      ? `<span class="other-card__dir">Dir. ${prod.director}</span>`
      : `<span class="other-card__dir"></span>`;
    return `
      <a href="filme.html?i=${index}&src=other" class="other-card">
        <div class="other-card__img">
          ${placeholderSVG()}
          <img src="${prod.imgPortrait || ''}" alt="${escHtml(title)}" loading="lazy" onerror="this.style.display='none'">
        </div>
        <div class="other-card__info">
          <div class="other-card__title">${escHtml(title)}</div>
          <div class="other-card__meta">
            ${dirHtml}
            <span class="other-card__year">${escHtml(prod.year || '')}</span>
          </div>
        </div>
      </a>`;
  }

  /* ── HOVER DOS OUTROS CARDS ── */
  function attachOtherCardHovers() {
    document.querySelectorAll('.other-card').forEach(card => {
      card.addEventListener('mouseenter', () => {
        cardColorIdx = (cardColorIdx + 1) % PALETTE.length;
        const color = PALETTE[cardColorIdx];
        card.style.outline = `2px solid ${color}`;
        card.querySelector('.other-card__title').style.color = color;
      });
      card.addEventListener('mouseleave', () => {
        card.style.outline = '';
        card.querySelector('.other-card__title').style.color = '';
      });
    });
  }

  /* ── RENDERIZA OUTRAS PRODUÇÕES ── */
  function renderOtherGrid() {
    const divider = document.getElementById('otherDivider');
    const grid    = document.getElementById('otherGrid');
    if (!otherProductions || otherProductions.length === 0) {
      divider.style.display = 'none';
      grid.innerHTML = '';
      return;
    }
    divider.style.display = 'flex';
    grid.innerHTML = otherProductions.map((prod, i) => createSmallCard(prod, i)).join('');
    attachOtherCardHovers();
  }

  /* ── updateDOM (chamada pelo script-shared ao trocar idioma) ── */
  window.updateDOM = function() {
    applyI18n();

    // Mantém o sort ativo ao trocar idioma
    const activeSort = document.querySelector('.sort-btn.active');
    const mode = activeSort ? activeSort.getAttribute('data-sort') : 'relevance';
    renderGrid(mode);
    renderOtherGrid();
  }


  /* ── i18next ── */
  i18next.init({
    lng: localStorage.getItem('lang') || 'pt',
    resources: {
      pt: {
        translation: {
          ...COMMON_I18N.pt,
          'nav.portfolio':          'Portfólio',
          'section.title':          (pagesData.producoes && pagesData.producoes.titlePt) || 'Produções',
          'sort.relevance':         'Relevância',
          'sort.recent':            'Recentes',
          'sort.az':                'A–Z',
        }
      },
      en: {
        translation: {
          ...COMMON_I18N.en,
          'nav.portfolio':          'Portfolio',
          'section.title':          (pagesData.producoes && pagesData.producoes.titleEn) || 'Productions',
          'sort.relevance':         'Relevance',
          'sort.recent':            'Latest',
          'sort.az':                'A–Z',
        }
      }
    }
  }, () => {
    applyI18n();
    renderGrid();
    renderOtherGrid();
  });
});