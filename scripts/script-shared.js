/* ============================================================
   script-shared.js
   Compartilhado entre todas as páginas do site pontos de fuga
   Depende de: i18next (carregado antes no HTML)
   ============================================================ */

/* ── PALETA CÍCLICA COMPARTILHADA ── */
const PALETTE = ['#c9a84c', '#c4622d', '#6b8f71', '#8b1a1a'];

/* ── ESCAPE HTML (S1 — previne XSS em templates innerHTML) ── */
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ── RECURSOS i18n COMUNS (menu + footer) ── */
const COMMON_I18N = {
  pt: {
    'nav.home': 'Início',
    'menu.home': 'Início', 'menu.home.count': 'Pag. inicial',
    'menu.productions': 'Produções', 'menu.productions.count': '10+',
    'menu.upcoming': 'Vem aí', 'menu.upcoming.count': 'Em produção',
    'menu.history': 'História', 'menu.history.count': 'Sobre',
    'menu.contact': 'Contato', 'menu.contact.count': 'fale com a gente',
    'footer.col1': 'Navegação', 'footer.copy': '© 2026 - PONTOS DE FUGA',
  },
  en: {
    'nav.home': 'Home',
    'menu.home': 'Home', 'menu.home.count': 'Beginning',
    'menu.productions': 'Productions', 'menu.productions.count': '10+',
    'menu.upcoming': 'Upcoming', 'menu.upcoming.count': 'In Production',
    'menu.history': 'Our Story', 'menu.history.count': 'About',
    'menu.contact': 'Contact', 'menu.contact.count': 'get in touch',
    'footer.col1': 'Navigation', 'footer.copy': '© 2026 - PONTOS DE FUGA',
  }
};

/* ── MAPA DE STATUS → chave i18n ── */
const statusKey = {
  filming: 'status.filming',
  dev:     'status.dev',
  post:    'status.post',
};

/* ── SCROLL REVEAL ── */
function observeReveal(threshold = 0.1) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        e.target.classList.add('visible');
        io.unobserve(e.target);
      }
    });
  }, { threshold });

  document.querySelectorAll('.reveal:not(.visible)').forEach(el => io.observe(el));
}

/* ── APLICA TRADUÇÕES data-i18n ── */
function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = i18next.t(el.getAttribute('data-i18n'));
  });
}

/* ── PLACEHOLDER SVG ── */
function placeholderSVG(size = 48, sw = 0.8, cls = 'film-card__placeholder') {
  return `<div class="${cls}"><svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="white"><rect x="3" y="3" width="18" height="18" rx="1" stroke-width="${sw}"/><circle cx="8.5" cy="8.5" r="1.5" stroke-width="${sw}"/><path d="M21 15l-5-5L5 21" stroke-width="${sw}"/></svg></div>`;
}

/* ── MENU TOGGLE ── */
const menuBtn     = document.getElementById('menuBtn');
const menuOverlay = document.getElementById('menuOverlay');
let menuOpen = false;

function openMenu() {
  menuOpen = true;
  menuOverlay.classList.add('open');
  menuBtn.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeMenu() {
  menuOpen = false;
  menuOverlay.classList.remove('open');
  menuBtn.classList.remove('open');
  document.body.style.overflow = '';
}

menuBtn.addEventListener('click', () => menuOpen ? closeMenu() : openMenu());

/* A3 — botão X injetado para fechar o menu */
const menuCloseBtn = document.createElement('button');
menuCloseBtn.className = 'menu-close-btn';
menuCloseBtn.setAttribute('aria-label', 'Fechar menu');
menuCloseBtn.textContent = '✕';
menuCloseBtn.addEventListener('click', closeMenu);
menuOverlay.insertBefore(menuCloseBtn, menuOverlay.firstChild);

/* N1 — destaca a página atual no menu overlay */
(function markCurrentPage() {
  const file = window.location.pathname.split('/').pop() || 'index.html';
  menuOverlay.querySelectorAll('.menu-primary-list a').forEach(link => {
    if (link.getAttribute('href') === file) link.classList.add('menu-link--active');
  });
})();

/* ── COR CÍCLICA DOS BOTÕES DA HEADER NO HOVER ── */
let headerColorIdx = -1;

menuBtn.addEventListener('mouseenter', () => {
  headerColorIdx = (headerColorIdx + 1) % PALETTE.length;
  menuBtn.style.color = PALETTE[headerColorIdx];
});
menuBtn.addEventListener('mouseleave', () => {
  menuBtn.style.color = '';
});

document.querySelectorAll('.header-link').forEach(el => {
  el.addEventListener('mouseenter', () => {
    headerColorIdx = (headerColorIdx + 1) % PALETTE.length;
    const color = PALETTE[headerColorIdx];
    el.style.color = color;
    el.style.borderColor = color;
    el.style.fontWeight = '700';
  });
  el.addEventListener('mouseleave', () => {
    el.style.color = '';
    el.style.borderColor = '';
    el.style.fontWeight = '';
  });
});

// Fecha o menu ao clicar fora dele
menuOverlay.addEventListener('click', e => {
  if (e.target === menuOverlay) closeMenu();
});

// Fecha o menu ao clicar em qualquer link de navegação
menuOverlay.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', closeMenu);
});



/* ── SELETOR DE IDIOMA (dropdown com bandeiras) ──
   Cada página define window.updateDOM(); este módulo chama após troca. ── */
(function () {
  const FLAGS = {
    pt: { src: 'https://flagcdn.com/w40/br.png', alt: 'Português' },
    en: { src: 'https://flagcdn.com/w40/us.png', alt: 'English' },
  };

  const selector    = document.getElementById('langSelector');
  const trigger     = document.getElementById('langBtn');
  const currentFlag = document.getElementById('langCurrentFlag');
  const optionBtn   = document.getElementById('langOptionBtn');
  const optionFlag  = document.getElementById('langOptionFlag');

  function syncFlags(activeLang) {
    const other = activeLang === 'pt' ? 'en' : 'pt';
    currentFlag.src = FLAGS[activeLang].src;
    currentFlag.alt = FLAGS[activeLang].alt;
    optionFlag.src  = FLAGS[other].src;
    optionFlag.alt  = FLAGS[other].alt;
    document.documentElement.lang = activeLang;
  }

  function openDropdown()  { selector.setAttribute('data-open', ''); trigger.setAttribute('aria-expanded', 'true'); }
  function closeDropdown() { selector.removeAttribute('data-open'); trigger.setAttribute('aria-expanded', 'false'); }
  function isOpen()        { return selector.hasAttribute('data-open'); }

  /* Atualiza bandeiras ao inicializar com o idioma salvo */
  i18next.on('initialized', () => syncFlags(i18next.language));

  /* Toggle do dropdown */
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpen() ? closeDropdown() : openDropdown();
  });

  /* Troca de idioma ao clicar na bandeira alternativa */
  optionBtn.addEventListener('click', () => {
    const next = i18next.language === 'pt' ? 'en' : 'pt';
    localStorage.setItem('lang', next);
    closeDropdown();
    i18next.changeLanguage(next, () => {
      syncFlags(next);
      if (typeof window.updateDOM === 'function') window.updateDOM();
    });
  });

  /* Fecha ao clicar fora */
  document.addEventListener('click', () => { if (isOpen()) closeDropdown(); });
})();

/* ── LOGO DINÂMICO ──
   Substitui o src da logo se siteData.logoUrl estiver definido no data.json ── */
dataReady.then(() => {
  // Aplica fontes personalizadas se definidas no siteData
  const sd = siteData || {};
  [['fontDisplayUrl', 'fontDisplayFamily', '--font-display'],
   ['fontUiUrl',      'fontUiFamily',      '--font-ui']
  ].forEach(([urlKey, familyKey, cssVar]) => {
    const url    = sd[urlKey];
    const family = sd[familyKey];
    if (url) {
      if (!document.querySelector(`link[href="${url}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;
        document.head.appendChild(link);
      }
    }
    if (family) document.documentElement.style.setProperty(cssVar, family);
  });

  if (siteData && siteData.logoUrl) {
    const logoImg = document.querySelector('.logo-img');
    if (logoImg) logoImg.src = siteData.logoUrl;
  }

  // Renderiza links sociais no footer e no menu overlay
  const links = siteData && Array.isArray(siteData.socialLinks) ? siteData.socialLinks : [];
  const linksHtml = links
    .filter(l => l.label && l.url)
    .map(l => `<a href="${l.url}" target="_blank" rel="noopener">${l.label}</a>`)
    .join('');
  document.querySelectorAll('.footer-social, .menu-social').forEach(el => {
    el.innerHTML = linksHtml;
  });
});

/* ── TEMA CLARO / ESCURO ──────────────────────────────────────────
   Tema controlado pelo admin via siteData.theme em data.json.
   localStorage é usado apenas como cache para evitar FOUC.
   ─────────────────────────────────────────────────────────────── */
(function () {
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }

  // Aplica o tema definido pelo admin assim que data.json carrega
  dataReady.then(() => {
    if (siteData && siteData.theme) applyTheme(siteData.theme);
  }).catch(() => {});
})();


/*HIDE HEADER AFTER SCROLL*/

var lastScrollTop = 0;
var header = document.querySelector('header');

window.addEventListener('scroll', function() {
    var scrollTop = window.pageYOffset || document.documentElement.scrollTop;

    if (scrollTop > lastScrollTop && scrollTop > 50) {
        // Scrolling down and past a certain threshold (e.g., 50px)
        if (!header.classList.contains('header--hidden')) {
            header.classList.add('header--hidden');
        }
    } else {
        // Scrolling up
        if (header.classList.contains('header--hidden')) {
            header.classList.remove('header--hidden');
        }
    }
    lastScrollTop = scrollTop;
});