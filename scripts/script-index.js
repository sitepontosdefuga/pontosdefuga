/* ============================================================
   script-index.js
   Lógica exclusiva da página index.html
   Depende de: i18next, script-shared.js
   ============================================================ */

dataReady.then(() => { /* espera os dados do json serem carregados */

/* ── STRIPE ── */
  function renderStripe() {
    const track = document.getElementById('stripeTrack');
    if (!track) return;
    const items = (pagesData.index && pagesData.index.stripeItems) ||
      ['Cinema Brasileiro Independente', 'Pontos de Fuga', 'Rio de Janeiro'];
    // Repete em número par para que translateX(-50%) faça loop perfeito sem gap
    const copies = Math.max(8, Math.ceil(window.innerWidth / (items.length * 150)) * 2);
    const repeated = Array.from({ length: copies }, () => items).flat();
    track.innerHTML = repeated.map(t => `<span class="stripe-item">${escHtml(t)}</span>`).join('');
  }
  renderStripe();

/* ── HERO SLIDESHOW ──
   Filmes marcados com hero:true no array films ── */

  const heroFilms = films.filter(f => f.hero);
  let currentSlide = 0;

  // Gera slides e dots dinamicamente — funciona com qualquer quantidade de heroFilms
  const slidesContainer = document.querySelector('.hero-slides');
  const dotsContainer   = document.getElementById('heroNav');

  slidesContainer.innerHTML = heroFilms.map((_, i) =>
    `<div class="hero-slide${i === 0 ? ' active' : ''}"></div>`
  ).join('');

  dotsContainer.innerHTML = heroFilms.map((_, i) =>
    `<div class="hero-dot${i === 0 ? ' active' : ''}" data-index="${i}"></div>`
  ).join('');

  const slides = document.querySelectorAll('.hero-slide');
  const dots   = document.querySelectorAll('.hero-dot');

  function goToSlide(n) {
    slides[currentSlide].classList.remove('active');
    dots[currentSlide].classList.remove('active');
    currentSlide = n;
    slides[currentSlide].classList.add('active');
    dots[currentSlide].classList.add('active');

    const f    = heroFilms[n];
    const lang = i18next.language;
    const title = lang === 'en' ? f.titleEn : f.title;

    // Atualiza imagem de fundo do slide
    if (f.imgLandscape) {
      slides[n].style.backgroundImage    = `url('${f.imgLandscape}')`;
      slides[n].style.backgroundSize     = 'cover';
      slides[n].style.backgroundPosition = 'center';
    } else {
      slides[n].style.backgroundImage = '';
    }

    // Atualiza texto do hero
    document.querySelector('.hero-title').textContent = title;
    document.querySelector('.hero-meta').textContent =
      `Dir. ${f.director} · ${f.genre || 'Drama'} · ${f.year}`;
  }

  dots.forEach(d => d.addEventListener('click', () => goToSlide(+d.dataset.index)));
  if (heroFilms.length > 1) {
    setInterval(() => goToSlide((currentSlide + 1) % heroFilms.length), 5000);
  }


  /* ── PREVIEW GRID ──
    Usa os 4 primeiros filmes do array `films` (script-shared.js),
    ignorando os "wide" para manter o grid equilibrado na home. ── */
  function renderPreview() {
    const lang = i18next.language;

    // Pega até 4 filmes normais para o preview da home
  const previewFilms = films.slice(0, 4);

    document.getElementById('previewGrid').innerHTML = previewFilms.map(f => {
      const originalIndex = films.indexOf(f);
      return `
        <a href="filme.html?i=${originalIndex}" class="preview-card reveal">
          <div class="preview-card__bg">
            ${placeholderSVG(48, 0.6)}
            <img class="preview-card__img-portrait"
                src="${f.imgPortrait}"
                alt="${escHtml(lang === 'en' ? f.titleEn : f.title)}"
                loading="lazy"
                onerror="this.style.display='none'">
          </div>
          <div class="preview-card__overlay"></div>
          <div class="preview-card__info">
            <div class="preview-card__year">${escHtml(f.year)}</div>
            <div class="preview-card__title">${escHtml(lang === 'en' ? f.titleEn : f.title)}</div>
            <div class="preview-card__dir">Dir. ${escHtml(f.director)}</div>
          </div>
        </a>`;
    }).join('');

    let previewColorIdx = -1;

    document.querySelectorAll('.preview-card').forEach(card => {
      card.addEventListener('mouseenter', () => {
        previewColorIdx = (previewColorIdx + 1) % PALETTE.length;
        const color = PALETTE[previewColorIdx];
        card.style.outline = `3px solid ${color}`;
        card.querySelector('.preview-card__title').style.color = color;
      });
      card.addEventListener('mouseleave', () => {
        card.style.outline = '';
        card.querySelector('.preview-card__title').style.color = '';
      });
    });

    observeReveal(0.15);
  }

  /* ── UPCOMING (lê upcomingFilms do script-shared.js) ── */

  function renderUpcoming() {
    const lang = i18next.language;

    document.getElementById('upcomingList').innerHTML = upcomingFilms.map((f, i) => {
      const title  = lang === 'en' ? f.titleEn : f.title;
      const status = i18next.t(statusKey[f.status]);
      const num    = String(i + 1).padStart(2, '0');
      const delay  = i > 0 ? `reveal-delay-${i}` : '';

      return `
        <li class="upcoming-item reveal ${delay}">
          <a href="filme.html?src=upcoming&i=${i}" class="upcoming-item__link">
            <span class="upcoming-item__num">${num}</span>
            <span class="upcoming-item__title">${escHtml(title)}</span>
            <div class="upcoming-item__meta">
              <div>Dir. ${escHtml(f.director)}</div>
              <div class="upcoming-item__status">${escHtml(status)}</div>
            </div>
          </a>
        </li>`;
    }).join('');

    observeReveal(0.15);
  }

  /* ── IDENTITY (tagline + sub do index, editáveis via admin) ── */
  function renderIdentity() {
    const lang = i18next.language;
    const m = historiaData.manifesto;
    if (!m) return;
    const tagline = document.querySelector('.identity-tagline');
    if (tagline) tagline.textContent = lang === 'en' ? m.identityStatementEn : m.identityStatement;
  }

  /* ── updateDOM (chamada pelo script-shared ao trocar idioma) ── */
  window.updateDOM = function() {
    applyI18n();
    renderIdentity();
    renderPreview();
    renderUpcoming();
    goToSlide(currentSlide);
  }


  /* ── i18next ── */
    i18next.init({
      lng: localStorage.getItem('lang') || 'pt',
      resources: {
        pt: {
          translation: {
            ...COMMON_I18N.pt,
            'nav.portfolio':          'Portfólio',
            'identity.link':          'Nossa história',
            'cta.eyebrow':            'Contato',
            'cta.title':              (pagesData.index && pagesData.index.ctaTitlePt)  || 'Tem uma história que precisa ser contada?',
            'cta.body':               (pagesData.index && pagesData.index.ctaBodyPt)   || 'Estamos sempre abertos a novos projetos, parcerias criativas e colaborações que valham a pena.',
            'cta.link':               'Fale com a gente',
            'hero.label':             (pagesData.index && pagesData.index.heroLabelPt) || 'Em destaque · 2025',
            'hero.cta':               'Ver portfólio',
            'hero.scroll':            'Scroll',
            'featured.eyebrow':       'Último lançamento',
            'featured.more':          'Saiba mais',
            'grid.title':             (pagesData.index && pagesData.index.gridTitlePt) || 'Produções recentes',
            'grid.all':               'Ver todas',
            'upcoming.title':         'Vem aí',
            'upcoming.sub':           'Em produção',
            'status.filming':         'Filmando',
            'status.dev':             'Desenvolvimento',
            'status.post':            'Pós-produção',
          }
        },
        en: {
          translation: {
            ...COMMON_I18N.en,
            'nav.portfolio':          'Portfolio',
            'identity.link':          'Our story',
            'cta.eyebrow':            'Contact',
            'cta.title':              (pagesData.index && pagesData.index.ctaTitleEn)  || 'Got a story that needs to be told?',
            'cta.body':               (pagesData.index && pagesData.index.ctaBodyEn)   || "We're always open to new projects, creative partnerships and collaborations worth making.",
            'cta.link':               'Get in touch',
            'hero.label':             (pagesData.index && pagesData.index.heroLabelEn) || 'Featured · 2025',
            'hero.cta':               'View portfolio',
            'hero.scroll':            'Scroll',
            'featured.eyebrow':       'Latest release',
            'featured.more':          'Learn more',
            'grid.title':             (pagesData.index && pagesData.index.gridTitleEn) || 'Recent productions',
            'grid.all':               'View all',
            'upcoming.title':         'Coming soon',
            'upcoming.sub':           'In production',
            'status.filming':         'Filming',
            'status.dev':             'Development',
            'status.post':            'Post-production',
          }
        }
      }
    }, () => {
      applyI18n();
      goToSlide(0);
      renderIdentity();
      renderPreview();
      renderUpcoming();
      observeReveal(0.15);
    });
});