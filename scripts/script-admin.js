/* ============================================================
   script-admin.js
   Admin com autenticação por senha criptografada (AES-GCM)
   O token GitHub fica criptografado no data.json (_auth.tokens)
   ============================================================ */

const REPO   = 'myceliumBrain/site-produtora';
const FILE   = 'scripts/data.json';
const BRANCH = 'lite_mode';

function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}


let TOKEN   = '';
let fileSHA = '';
let data    = {};


/* ══════════════════════════════════════════════════════════
   CRYPTO — Web Crypto API (nativa no browser)
══════════════════════════════════════════════════════════ */
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64ToBytes(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
function bytesToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function encryptToken(token, password) {
  const salt      = crypto.getRandomValues(new Uint8Array(16));
  const iv        = crypto.getRandomValues(new Uint8Array(12));
  const key       = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, enc.encode(token)
  );
  return {
    salt: bytesToB64(salt),
    iv:   bytesToB64(iv),
    data: bytesToB64(encrypted)
  };
}

async function decryptToken(entry, password) {
  try {
    const salt = b64ToBytes(entry.salt);
    const iv   = b64ToBytes(entry.iv);
    const key  = await deriveKey(password, salt);
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv }, key, b64ToBytes(entry.data)
    );
    return dec.decode(decrypted);
  } catch {
    return null; // senha errada
  }
}

/* ══════════════════════════════════════════════════════════
   GITHUB API (sem token ainda — só para carregar o JSON)
══════════════════════════════════════════════════════════ */
async function ghGet(path) {
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (TOKEN) headers.Authorization = `token ${TOKEN}`;
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}?ref=${BRANCH}&_=${Date.now()}`,
    { headers }
  );
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function ghPut(path, content, sha, message) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `token ${TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message,
        content: btoa(String.fromCharCode(...new TextEncoder().encode(content))),
        sha,
        branch: BRANCH
      })
    }
  );
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || `PUT → ${res.status}`); }
  return res.json();
}

async function ghPutBinary(path, base64Content, message) {
  // Se o arquivo já existir no caminho de destino, o GitHub exige o sha para atualizar
  let sha;
  try { sha = (await ghGet(path)).sha; } catch { /* arquivo novo — sha não necessário */ }

  const body = { message, content: base64Content, branch: BRANCH };
  if (sha) body.sha = sha;

  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `token ${TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || `PUT → ${res.status}`); }
  return res.json();
}

async function ghDelete(path, sha, message) {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/contents/${path}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `token ${TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message, sha, branch: BRANCH })
    }
  );
  if (!res.ok) { const e = await res.json(); throw new Error(e.message || `DELETE → ${res.status}`); }
  return res.json();
}


async function loadData(tok) {
  if (tok) TOKEN = tok;
  const file = await ghGet(FILE);
  fileSHA = file.sha;
  const raw = atob(file.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
  data = JSON.parse(new TextDecoder().decode(bytes));
}

async function saveData(commitMsg) {
  // Busca o sha atual do arquivo antes de salvar — evita conflito 409
  // quando uploads de assets ou outra sessão fizeram commits após o login
  const current = await ghGet(FILE);
  fileSHA = current.sha;
  const result = await ghPut(FILE, JSON.stringify(data, null, 2), fileSHA, commitMsg);
  fileSHA = result.content.sha;
}

/* ══════════════════════════════════════════════════════════
   LOGIN
══════════════════════════════════════════════════════════ */
/* ── BRUTE-FORCE PROTECTION ── */
const LOGIN_KEY     = 'pf_login_attempts';
const MAX_ATTEMPTS  = 5;
const LOCKOUT_MS    = 15 * 60 * 1000; // 15 min

function getLoginState() {
  try { return JSON.parse(localStorage.getItem(LOGIN_KEY)) || {}; } catch { return {}; }
}
function setLoginState(s) { localStorage.setItem(LOGIN_KEY, JSON.stringify(s)); }

function checkLockout() {
  const s = getLoginState();
  if (s.lockedUntil && Date.now() < s.lockedUntil) {
    const mins = Math.ceil((s.lockedUntil - Date.now()) / 60000);
    return `Muitas tentativas. Aguarde ${mins} min.`;
  }
  return null;
}

function recordFailedAttempt() {
  const s = getLoginState();
  s.attempts = (s.attempts || 0) + 1;
  if (s.attempts >= MAX_ATTEMPTS) {
    s.lockedUntil = Date.now() + LOCKOUT_MS;
    s.attempts = 0;
  }
  setLoginState(s);
}

function clearLoginState() { localStorage.removeItem(LOGIN_KEY); }

async function doLogin() {
  const lockMsg = checkLockout();
  if (lockMsg) {
    document.getElementById('loginErr').textContent = lockMsg;
    return;
  }

  const password = document.getElementById('passwordInput').value.trim();
  if (!password) return;

  const btn = document.getElementById('loginBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> verificando…';
  document.getElementById('loginErr').textContent = '';

  try {
    await loadData();

    const tokens = data._auth?.tokens || [];
    if (tokens.length === 0) {
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('setupScreen').style.display = 'flex';
      btn.disabled = false;
      btn.innerHTML = 'Entrar →';
      return;
    }

    let decryptedToken = null;
    for (const entry of tokens) {
      decryptedToken = await decryptToken(entry, password);
      if (decryptedToken) break;
    }

    if (!decryptedToken) {
      recordFailedAttempt();
      const remaining = MAX_ATTEMPTS - (getLoginState().attempts || 0);
      const lockMsg2 = checkLockout();
      throw new Error(lockMsg2 || `Senha incorreta. ${remaining > 0 ? remaining + ' tentativa(s) restante(s).' : ''}`);
    }

    clearLoginState();
    TOKEN = decryptedToken;
    showApp();

  } catch (e) {
    document.getElementById('loginErr').textContent = e.message;
    btn.disabled = false;
    btn.innerHTML = 'Entrar →';
  }
}

document.getElementById('passwordInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('setupScreen').style.display = 'none';
  document.getElementById('app').style.display = 'block';
  renderAll();
  setStatus('dados carregados ✓', 'ok');
}

function doLogout() {
  TOKEN = ''; fileSHA = ''; data = {};
  document.getElementById('app').style.display = 'none';
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('passwordInput').value = '';
  document.getElementById('loginErr').textContent = '';
}

/* ══════════════════════════════════════════════════════════
   SETUP — primeira configuração (nenhuma senha cadastrada)
══════════════════════════════════════════════════════════ */
async function doSetup() {
  const token    = document.getElementById('setupToken').value.trim();
  const password = document.getElementById('setupPassword').value.trim();
  const label    = document.getElementById('setupLabel').value.trim() || 'admin';

  if (!token || !password) {
    document.getElementById('setupErr').textContent = 'Preencha token e senha.';
    return;
  }

  const btn = document.getElementById('setupBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> salvando…';

  try {
    TOKEN = token;
    await loadData(token);

    const encrypted = await encryptToken(token, password);
    if (!data._auth) data._auth = { tokens: [] };
    data._auth.tokens.push({ label, ...encrypted });
    await saveData('admin: configura autenticação');
    showApp();
  } catch (e) {
    document.getElementById('setupErr').textContent = 'Erro: ' + e.message;
    btn.disabled = false;
    btn.innerHTML = 'Salvar e entrar →';
  }
}

/* ══════════════════════════════════════════════════════════
   GERENCIAR ACESSOS
══════════════════════════════════════════════════════════ */
function renderAcessos() {
  const tokens = data._auth?.tokens || [];
  document.getElementById('acessosList').innerHTML = tokens.length === 0
    ? '<p style="font-family:var(--mono);font-size:0.8rem;color:var(--muted)">Nenhum acesso cadastrado.</p>'
    : tokens.map((t, i) => `
        <div class="card" style="margin-bottom:0.5rem">
          <div class="card-header" style="cursor:default">
            <div class="card-header-left">
              <span class="card-num">${String(i+1).padStart(2,'0')}</span>
              <span class="card-name">${t.label || 'sem nome'}</span>
            </div>
            <button class="btn btn-danger btn-small" onclick="revokeAccess(${i})">Revogar</button>
          </div>
        </div>`).join('');
}

async function addAccess() {
  const token    = document.getElementById('newToken').value.trim();
  const password = document.getElementById('newPassword').value.trim();
  const label    = document.getElementById('newLabel').value.trim() || 'usuário';

  if (!token || !password) {
    toast('Preencha token e senha.', 'err'); return;
  }

  const btn = document.getElementById('addAccessBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';

  try {
    const encrypted = await encryptToken(token, password);
    if (!data._auth) data._auth = { tokens: [] };
    data._auth.tokens.push({ label, ...encrypted });
    await saveData('admin: adiciona acesso');
    renderAcessos();
    document.getElementById('newToken').value = '';
    document.getElementById('newPassword').value = '';
    document.getElementById('newLabel').value = '';
    toast('Acesso adicionado!', 'ok');
  } catch (e) {
    toast('Erro: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '+ adicionar acesso';
  }
}

async function revokeAccess(i) {
  if (!confirm(`Revogar acesso de "${data._auth.tokens[i].label}"?`)) return;
  data._auth.tokens.splice(i, 1);
  try {
    await saveData('admin: revoga acesso');
    renderAcessos();
    toast('Acesso revogado.', 'ok');
  } catch (e) {
    toast('Erro: ' + e.message, 'err');
  }
}

/* ══════════════════════════════════════════════════════════
   NAV
══════════════════════════════════════════════════════════ */
function showPanel(name) {
  document.querySelectorAll('.section-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('panel-' + name).classList.add('active');
  document.querySelector(`[onclick="showPanel('${name}')"]`).classList.add('active');
  if (name === 'acessos') renderAcessos();
  if (name === 'estilo')  renderEstilo();
  closeAdmDrawer();
}

function toggleAdmDrawer() {
  const sidebar  = document.querySelector('.adm-sidebar');
  const backdrop = document.getElementById('admDrawerBackdrop');
  const open     = sidebar.classList.toggle('open');
  backdrop.classList.toggle('open', open);
}

function closeAdmDrawer() {
  document.querySelector('.adm-sidebar').classList.remove('open');
  document.getElementById('admDrawerBackdrop').classList.remove('open');
}

/* ══════════════════════════════════════════════════════════
   RENDER ALL
══════════════════════════════════════════════════════════ */
function renderAll() {
  if (!data.siteData) data.siteData = {};
  renderFilms();
  renderOtherProductions();
  renderUpcoming();
  renderPagHistoria();
  renderPagPrincipal();
  renderPagProducoes();
  renderPagContato();
  renderLinks();
  renderEstilo();
  renderTipografia();
  renderPagVemai();
  renderFestivais();
  renderParceiros();
  document.getElementById('saveBtn').disabled = false;
}

/* ══════════════════════════════════════════════════════════
   SAVE ALL
══════════════════════════════════════════════════════════ */
async function saveAll() {
  collectAll();
  const btn = document.getElementById('saveBtn');
  btn.disabled = true;
  document.getElementById('saveBtnText').innerHTML = '<span class="spinner"></span>';
  setStatus('salvando…', '');
  try {
    await saveData('admin: atualiza data.json');
    setStatus('salvo ✓', 'ok');
    toast('Salvo no GitHub!', 'ok');
  } catch (e) {
    setStatus('erro ao salvar ✗', 'err');
    toast('Erro: ' + e.message, 'err');
  } finally {
    btn.disabled = false;
    document.getElementById('saveBtnText').textContent = 'Salvar no GitHub';
  }
}

/* ══════════════════════════════════════════════════════════
   SAVE CARD — salva um item individual e re-renderiza o header
══════════════════════════════════════════════════════════ */

/**
 * Coleta os campos de um card, atualiza `data` em memória
 * e re-renderiza o painel. NÃO faz commit no GitHub.
 *
 * @param {string} type  'film' | 'upcoming' | 'marco' | 'team'
 * @param {number} i     Índice do item no array
 */
function saveCard(type, i) {
  // Coleta todos os campos do formulário para `data` em memória (sem commit)
  collectAll();

  // Re-renderiza o painel para refletir mudanças no header (título, ano, etc.)
  const renderMap = { film: renderFilms, other: renderOtherProductions, upcoming: renderUpcoming, festival: renderFestivais };
  if (renderMap[type]) renderMap[type]();

  // Reabre o card e desabilita o botão salvar até haver nova alteração
  const cardId = `${type}-card-${i}`;
  const card = document.getElementById(cardId);
  if (card) {
    card.classList.add('open');
    const saveBtn = card.querySelector('.card-actions .btn-primary');
    if (saveBtn) {
      saveBtn.disabled = true;
      const reEnable = () => {
        saveBtn.disabled = false;
        card.removeEventListener('input',  reEnable);
        card.removeEventListener('change', reEnable);
      };
      card.addEventListener('input',  reEnable);
      card.addEventListener('change', reEnable);
    }
  }

  toast('Visual atualizado — clique em “Salvar no GitHub” para confirmar.', 'ok');
}

/* ══════════════════════════════════════════════════════════
   REORDER — ferramenta genérica de reordenação
   Usada por: films, upcomingFilms
══════════════════════════════════════════════════════════ */

/**
 * Move um item do array na posição `fromIdx` para `toIdx`.
 * Após mover, re-renderiza a lista e salva automaticamente no GitHub.
 *
 * @param {Array}    arr        Referência ao array em `data`
 * @param {number}   fromIdx    Índice atual do item
 * @param {number}   toIdx      Índice de destino
 * @param {Function} renderFn   Função que re-renderiza o painel (ex: renderFilms)
 * @param {string}   commitMsg  Mensagem do commit no GitHub
 */
function moveItem(arr, fromIdx, toIdx, renderFn) {
  if (toIdx < 0 || toIdx >= arr.length) return;

  // Coleta os valores dos campos abertos antes de reorganizar
  collectAll();

  // Troca os elementos
  const [removed] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, removed);

  // Re-renderiza visualmente (sem commit — aguarda "Salvar no GitHub")
  renderFn();

  toast('Ordem atualizada — clique em “Salvar no GitHub” para confirmar.', 'ok');
}

/**
 * Gera o HTML dos botões de seta para reordenação.
 * A seta para cima é desabilitada no primeiro item;
 * a seta para baixo é desabilitada no último.
 *
 * @param {number} idx       Índice atual do item
 * @param {number} total     Total de itens no array
 * @param {string} moveUpFn  String com a chamada JS para mover para cima
 * @param {string} moveDnFn  String com a chamada JS para mover para baixo
 */
function reorderBtns(idx, total, moveUpFn, moveDnFn) {
  return `
    <div class="reorder-btns">
      <button class="reorder-btn" title="Mover para cima"
        ${idx === 0 ? 'disabled' : ''}
        onclick="${moveUpFn}">▲</button>
      <button class="reorder-btn" title="Mover para baixo"
        ${idx === total - 1 ? 'disabled' : ''}
        onclick="${moveDnFn}">▼</button>
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   FILMS
══════════════════════════════════════════════════════════ */
function renderFilms() {
  const films = data.films || [];
  // migrate legacy videoTrailer string → videoTrailers array
  films.forEach(f => {
    if (!Array.isArray(f.videoTrailers)) f.videoTrailers = f.videoTrailer ? [f.videoTrailer] : [];
  });
  document.getElementById('filmsCount').textContent = films.length;
  document.getElementById('filmsPanelCount').textContent = films.length + ' filmes';
  document.getElementById('filmsList').innerHTML = films.map((f, i) => `
    <div class="card" id="film-card-${i}">
      <div class="card-header" onclick="toggleCard('film-card-${i}')">
        <div class="card-header-left">
          ${reorderBtns(i, films.length,
            `event.stopPropagation(); moveFilm(${i}, ${i-1})`,
            `event.stopPropagation(); moveFilm(${i}, ${i+1})`
          )}
          <span class="card-num">${String(i+1).padStart(2,'0')}</span>
          <span class="card-name">${f.title || '(sem título)'}</span>
          <span class="card-meta">${f.year||''} · ${f.genre||''}</span>
        </div>
        <span class="card-chevron">▼</span>
      </div>
      <div class="card-body">
        <div class="fields-grid">
          <div class="field"><label>Título PT</label><input data-film="${i}" data-key="title" value="${esc(f.title)}"></div>
          <div class="field"><label>Título EN</label><input data-film="${i}" data-key="titleEn" value="${esc(f.titleEn)}"></div>
          <div class="field"><label>Diretor</label><input data-film="${i}" data-key="director" value="${esc(f.director)}"></div>
          <div class="field"><label>Ano</label><input data-film="${i}" data-key="year" value="${esc(f.year)}"></div>
          <div class="field"><label>Gênero</label><input data-film="${i}" data-key="genre" value="${esc(f.genre)}"></div>
          <div class="field" style="display:flex;flex-direction:column;justify-content:center;padding-top:1.5rem;gap:4px;">
            <label class="checkbox-row">
              <input type="checkbox" data-film="${i}" data-key="hero" ${f.hero?'checked':''}>
              Aparece no hero
            </label>
            <span class="field-note" style="margin-left:0">necessário ter imagem paisagem (horizontal)</span>
          </div>
          ${crewField('ficha',  'film', i, f.fichatecnica||[], 'Ficha Técnica')}
          ${crewField('elenco', 'film', i, f.elenco||[],       'Elenco')}
          <div class="field full"><label>Sinopse PT</label><textarea data-film="${i}" data-key="synopsis">${esc(f.synopsis)}</textarea></div>
          <div class="field full"><label>Sinopse EN</label><textarea data-film="${i}" data-key="synopsisEn">${esc(f.synopsisEn)}</textarea></div>
          ${imgField('film', i, 'imgPortrait',  'Imagem retrato (vertical)',   f.imgPortrait,  'recomendado 800 × 1067 px · proporção 3:4 · usado nos cards (4 colunas desktop / 2 mobile)')}
          ${imgField('film', i, 'imgLandscape', 'Imagem paisagem (horizontal)', f.imgLandscape, 'recomendado 1920 × 1080 px · proporção 16:9 · obrigatório para aparecer no hero e featured')}
          <hr class="fields-divider">
          ${previewField('film', i, f.videoHover||'')}
          <hr class="fields-divider">
          ${trailersField('film', i, f.videoTrailers)}
          <hr class="fields-divider">
          ${fotografiasField('film', i, f.fotografias)}
          ${makingOffField('film', i, f.makingOff)}
          <div class="field full">
            <label>Tags</label>
            <div id="tags-film-${i}">${renderTags(f.tags||[], 'film', i)}</div>
            <div class="tags-input-row">
              <input id="tagInput-film-${i}" placeholder="nova tag…"
                     onkeydown="if(event.key==='Enter'){addTag('film',${i});event.preventDefault()}">
              <button class="btn btn-secondary btn-small" onclick="addTag('film',${i})">+ tag</button>
            </div>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn btn-danger btn-small" onclick="removeFilm(${i})">Remover filme</button>
          <button class="btn btn-primary btn-small" onclick="saveCard('film',${i})">Salvar</button>
        </div>
      </div>
    </div>`).join('');
}

function moveFilm(fromIdx, toIdx) {
  moveItem(data.films, fromIdx, toIdx, renderFilms);
}

function addFilm() {
  data.films.push({ title:'', titleEn:'', director:'', year:'', genre:'Drama',
    hero:false, synopsis:'', synopsisEn:'', fichatecnica:[], elenco:[], tags:[],
    imgPortrait:'', imgLandscape:'', videoHover:'', videoTrailers:[],
    videoMakingOff:'', fotografias:[], makingOff:[] });
  renderFilms();
  const idx = data.films.length - 1;
  toggleCard(`film-card-${idx}`);
  document.getElementById(`film-card-${idx}`).scrollIntoView({ behavior:'smooth' });
}

function removeFilm(i) {
  if (!confirm(`Remover "${data.films[i].title || 'esta produção'}"?`)) return;
  data.films.splice(i, 1);
  renderFilms();
}

/* ══════════════════════════════════════════════════════════
   OTHER PRODUCTIONS
══════════════════════════════════════════════════════════ */
function renderOtherProductions() {
  const items = data.otherProductions || [];
  // migrate legacy videoTrailer string → videoTrailers array
  items.forEach(f => {
    if (!Array.isArray(f.videoTrailers)) f.videoTrailers = f.videoTrailer ? [f.videoTrailer] : [];
  });
  document.getElementById('otherPanelCount').textContent = items.length + ' itens';
  document.getElementById('otherProductionsList').innerHTML = items.map((f, i) => `
    <div class="card" id="other-card-${i}">
      <div class="card-header" onclick="toggleCard('other-card-${i}')">
        <div class="card-header-left">
          ${reorderBtns(i, items.length,
            `event.stopPropagation(); moveOtherProduction(${i}, ${i-1})`,
            `event.stopPropagation(); moveOtherProduction(${i}, ${i+1})`
          )}
          <span class="card-num">${String(i+1).padStart(2,'0')}</span>
          <span class="card-name">${f.title || '(sem título)'}</span>
          <span class="card-meta">${f.year||''} · ${f.genre||''}</span>
        </div>
        <span class="card-chevron">▼</span>
      </div>
      <div class="card-body">
        <div class="fields-grid">
          <div class="field"><label>Título PT</label><input data-other="${i}" data-key="title" value="${esc(f.title)}"></div>
          <div class="field"><label>Título EN</label><input data-other="${i}" data-key="titleEn" value="${esc(f.titleEn)}"></div>
          <div class="field"><label>Diretor</label><input data-other="${i}" data-key="director" value="${esc(f.director)}"></div>
          <div class="field"><label>Ano</label><input data-other="${i}" data-key="year" value="${esc(f.year)}"></div>
          <div class="field full"><label>Gênero</label><input data-other="${i}" data-key="genre" value="${esc(f.genre)}"></div>
          ${crewField('ficha',  'other', i, f.fichatecnica||[], 'Ficha Técnica')}
          ${crewField('elenco', 'other', i, f.elenco||[],       'Elenco')}
          <div class="field full"><label>Sinopse PT</label><textarea data-other="${i}" data-key="synopsis">${esc(f.synopsis)}</textarea></div>
          <div class="field full"><label>Sinopse EN</label><textarea data-other="${i}" data-key="synopsisEn">${esc(f.synopsisEn)}</textarea></div>
          ${imgField('other', i, 'imgPortrait',  'Imagem retrato (vertical)',    f.imgPortrait||'',  'recomendado 800 × 1067 px · proporção 3:4 · usado nos cards (4 colunas desktop / 2 mobile)')}
          ${imgField('other', i, 'imgLandscape', 'Imagem paisagem (horizontal)', f.imgLandscape||'', 'recomendado 1920 × 1080 px · proporção 16:9 · usado na seção destaque em mobile')}
          <hr class="fields-divider">
          ${previewField('other', i, f.videoHover||'')}
          <hr class="fields-divider">
          ${trailersField('other', i, f.videoTrailers)}
          <hr class="fields-divider">
          ${fotografiasField('other', i, f.fotografias)}
          ${makingOffField('other', i, f.makingOff)}
        </div>
        <div class="card-actions">
          <button class="btn btn-danger btn-small" onclick="removeOtherProduction(${i})">Remover</button>
          <button class="btn btn-primary btn-small" onclick="saveCard('other',${i})">Salvar</button>
        </div>
      </div>
    </div>`).join('');
}

function moveOtherProduction(fromIdx, toIdx) {
  moveItem(data.otherProductions, fromIdx, toIdx, renderOtherProductions);
}

function addOtherProduction() {
  if (!data.otherProductions) data.otherProductions = [];
  data.otherProductions.push({ title:'', titleEn:'', director:'', year:'', genre:'',
    synopsis:'', synopsisEn:'', fichatecnica:[], elenco:[],
    imgPortrait:'', imgLandscape:'', videoHover:'', videoTrailers:[],
    fotografias:[], makingOff:[] });
  renderOtherProductions();
  const idx = data.otherProductions.length - 1;
  toggleCard(`other-card-${idx}`);
  document.getElementById(`other-card-${idx}`).scrollIntoView({ behavior:'smooth' });
}

function removeOtherProduction(i) {
  if (!confirm(`Remover "${data.otherProductions[i].title || 'esta produção'}"?`)) return;
  data.otherProductions.splice(i, 1);
  renderOtherProductions();
}

/* ══════════════════════════════════════════════════════════
   UPCOMING
══════════════════════════════════════════════════════════ */
function renderUpcoming() {
  const films = data.upcomingFilms || [];
  document.getElementById('upcomingCount').textContent = films.length;
  document.getElementById('upcomingPanelCount').textContent = films.length + ' projetos';
  document.getElementById('upcomingList').innerHTML = films.map((f, i) => `
    <div class="card" id="upcoming-card-${i}">
      <div class="card-header" onclick="toggleCard('upcoming-card-${i}')">
        <div class="card-header-left">
          ${reorderBtns(i, films.length,
            `event.stopPropagation(); moveUpcoming(${i}, ${i-1})`,
            `event.stopPropagation(); moveUpcoming(${i}, ${i+1})`
          )}
          <span class="card-num">${String(i+1).padStart(2,'0')}</span>
          <span class="card-name">${f.title||'(sem título)'}</span>
          <span class="status-chip status-${f.status}">${f.status||''}</span>
        </div>
        <span class="card-chevron">▼</span>
      </div>
      <div class="card-body">
        <div class="fields-grid">
          <div class="field"><label>Título PT</label><input data-upcoming="${i}" data-key="title" value="${esc(f.title)}"></div>
          <div class="field"><label>Título EN</label><input data-upcoming="${i}" data-key="titleEn" value="${esc(f.titleEn)}"></div>
          <div class="field"><label>Diretor</label><input data-upcoming="${i}" data-key="director" value="${esc(f.director)}"></div>
          <div class="field"><label>Ano previsto</label><input data-upcoming="${i}" data-key="year" value="${esc(f.year)}"></div>
          <div class="field"><label>Gênero PT</label><input data-upcoming="${i}" data-key="genre" value="${esc(f.genre)}"></div>
          <div class="field"><label>Gênero EN</label><input data-upcoming="${i}" data-key="genreEn" value="${esc(f.genreEn)}"></div>
          <div class="field"><label>Status</label>
            <select data-upcoming="${i}" data-key="status">
              <option value="filming" ${f.status==='filming'?'selected':''}>Filmando</option>
              <option value="dev"     ${f.status==='dev'?'selected':''}>Desenvolvimento</option>
              <option value="post"    ${f.status==='post'?'selected':''}>Pós-produção</option>
            </select>
          </div>
          <div class="field full"><label>Sinopse PT</label><textarea data-upcoming="${i}" data-key="synopsis">${esc(f.synopsis)}</textarea></div>
          <div class="field full"><label>Sinopse EN</label><textarea data-upcoming="${i}" data-key="synopsisEn">${esc(f.synopsisEn)}</textarea></div>
          ${imgField('upcoming', i, 'imgPortrait',  'Imagem retrato',  f.imgPortrait,  'recomendado 800 × 1067 px · proporção 3:4 · usado nos cards e seção "Em produção"')}
          ${imgField('upcoming', i, 'imgLandscape', 'Imagem paisagem', f.imgLandscape, 'recomendado 1920 × 1080 px · proporção 16:9 · usado na seção destaque em mobile')}
        </div>
        <div class="card-actions">
          <button class="btn btn-danger btn-small" onclick="removeUpcoming(${i})">Remover</button>
          <button class="btn btn-primary btn-small" onclick="saveCard('upcoming',${i})">Salvar</button>
        </div>
      </div>
    </div>`).join('');
}

function moveUpcoming(fromIdx, toIdx) {
  moveItem(data.upcomingFilms, fromIdx, toIdx, renderUpcoming);
}

function addUpcoming() {
  data.upcomingFilms.push({ title:'', titleEn:'', director:'', status:'dev',
    genre:'', genreEn:'', year:'', synopsis:'', synopsisEn:'', imgPortrait:'', imgLandscape:'' });
  renderUpcoming();
  toggleCard(`upcoming-card-${data.upcomingFilms.length - 1}`);
}

function removeUpcoming(i) {
  if (!confirm(`Remover "${data.upcomingFilms[i].title || 'este projeto'}"?`)) return;
  data.upcomingFilms.splice(i, 1);
  renderUpcoming();
}

/* ══════════════════════════════════════════════════════════
   MANIFESTO
══════════════════════════════════════════════════════════ */
function renderPagHistoria() {
  const m = data.historiaData.manifesto;
  const h = (data.pagesData && data.pagesData.historia) || {};
  document.getElementById('pagHistoriaForm').innerHTML = `
    <div class="panel-header" style="margin-top:0"><span class="panel-title" style="font-size:14px">Cabeçalho da página</span></div>
    <div class="fields-grid">
      <div class="field"><label>Etiqueta PT</label><input id="m-eyebrow"   value="${esc(m.eyebrow)}"></div>
      <div class="field"><label>Etiqueta EN</label><input id="m-eyebrowEn" value="${esc(m.eyebrowEn)}"></div>
      <div class="field"><label>Título linha 1 PT</label><input id="m-title1"   value="${esc(m.title1)}"></div>
      <div class="field"><label>Título linha 1 EN</label><input id="m-title1En" value="${esc(m.title1En)}"></div>
      <div class="field"><label>Título linha 2 PT</label><input id="m-title2"   value="${esc(m.title2)}"></div>
      <div class="field"><label>Título linha 2 EN</label><input id="m-title2En" value="${esc(m.title2En)}"></div>
      <div class="field full"><label>Parágrafo 1 PT</label><textarea id="m-p1">${esc(m.p1)}</textarea></div>
      <div class="field full"><label>Parágrafo 1 EN</label><textarea id="m-p1En">${esc(m.p1En)}</textarea></div>
      <div class="field full"><label>Parágrafo 2 PT</label><textarea id="m-p2">${esc(m.p2)}</textarea></div>
      <div class="field full"><label>Parágrafo 2 EN</label><textarea id="m-p2En">${esc(m.p2En)}</textarea></div>
    </div>
    <div class="panel-header" style="margin-top:2rem"><span class="panel-title" style="font-size:14px">Etiquetas das seções</span></div>
    <div class="fields-grid">
      <div class="field"><label>Festivais PT</label><input id="h-festivaisEyebrowPt" value="${esc(h.festivaisEyebrowPt||'')}"></div>
      <div class="field"><label>Festivais EN</label><input id="h-festivaisEyebrowEn" value="${esc(h.festivaisEyebrowEn||'')}"></div>
      <div class="field"><label>Parceiros PT</label><input id="h-parceirosEyebrowPt" value="${esc(h.parceirosEyebrowPt||'')}"></div>
      <div class="field"><label>Parceiros EN</label><input id="h-parceirosEyebrowEn" value="${esc(h.parceirosEyebrowEn||'')}"></div>
    </div>`;
}

function renderPagPrincipal() {
  const ix = (data.pagesData && data.pagesData.index) || {};
  const sd = data.siteData || {};
  document.getElementById('pagPrincipalForm').innerHTML = `
    <div class="panel-header" style="margin-top:0"><span class="panel-title" style="font-size:14px">Identidade visual</span></div>
    <div class="fields-grid">
      ${imgField('sitedata', 0, 'logoUrl', 'Logo do site', sd.logoUrl || '',
        'PNG ou SVG com fundo transparente · altura recomendada 56–80 px · exibido a 28 px de altura no header')}
    </div>
    <div class="panel-header" style="margin-top:2rem"><span class="panel-title" style="font-size:14px">Banner principal</span></div>
    <div class="fields-grid">
      <div class="field"><label>Etiqueta PT</label><input id="ix-heroLabelPt" value="${esc(ix.heroLabelPt||'')}"></div>
      <div class="field"><label>Etiqueta EN</label><input id="ix-heroLabelEn" value="${esc(ix.heroLabelEn||'')}"></div>
    </div>
    <div class="panel-header" style="margin-top:2rem"><span class="panel-title" style="font-size:14px">Grid de produções recentes</span></div>
    <div class="fields-grid">
      <div class="field"><label>Título PT</label><input id="ix-gridTitlePt" value="${esc(ix.gridTitlePt||'')}"></div>
      <div class="field"><label>Título EN</label><input id="ix-gridTitleEn" value="${esc(ix.gridTitleEn||'')}"></div>
    </div>
    <div class="panel-header" style="margin-top:2rem"><span class="panel-title" style="font-size:14px">Texto Carrossel</span></div>
    <div id="stripeItemsList">${renderStripeItems(ix.stripeItems || [])}</div>
    <div class="tags-input-row" style="margin-top:8px">
      <input id="stripeItemInput" placeholder="novo item…"
             onkeydown="if(event.key==='Enter'){addStripeItem();event.preventDefault()}">
      <button class="btn btn-secondary btn-small" onclick="addStripeItem()">+ adicionar</button>
    </div>
    <div class="panel-header" style="margin-top:2rem"><span class="panel-title" style="font-size:14px">Seção "Fale conosco"</span></div>
    <div class="fields-grid">
      <div class="field full"><label>Título PT</label><input id="ix-ctaTitlePt" value="${esc(ix.ctaTitlePt||'')}"></div>
      <div class="field full"><label>Título EN</label><input id="ix-ctaTitleEn" value="${esc(ix.ctaTitleEn||'')}"></div>
      <div class="field full"><label>Texto PT</label><textarea id="ix-ctaBodyPt">${esc(ix.ctaBodyPt||'')}</textarea></div>
      <div class="field full"><label>Texto EN</label><textarea id="ix-ctaBodyEn">${esc(ix.ctaBodyEn||'')}</textarea></div>
    </div>`;
}

function renderPagProducoes() {
  const p = (data.pagesData && data.pagesData.producoes) || {};
  document.getElementById('pagProducoesForm').innerHTML = `
    <div class="fields-grid">
      <div class="field"><label>Título PT</label><input id="pp-titlePt" value="${esc(p.titlePt||'')}"></div>
      <div class="field"><label>Título EN</label><input id="pp-titleEn" value="${esc(p.titleEn||'')}"></div>
    </div>`;
}

function renderPagContato() {
  const c = (data.pagesData && data.pagesData.contato) || {};
  document.getElementById('pagContatoForm').innerHTML = `
    <div class="fields-grid">
      <div class="field"><label>Etiqueta PT</label><input id="pc-eyebrowPt" value="${esc(c.eyebrowPt||'')}"></div>
      <div class="field"><label>Etiqueta EN</label><input id="pc-eyebrowEn" value="${esc(c.eyebrowEn||'')}"></div>
      <div class="field"><label>Título PT</label><input id="pc-titlePt" value="${esc(c.titlePt||'')}"></div>
      <div class="field"><label>Título EN</label><input id="pc-titleEn" value="${esc(c.titleEn||'')}"></div>
      <div class="field full"><label>Subtítulo PT</label><textarea id="pc-subPt">${esc(c.subPt||'')}</textarea></div>
      <div class="field full"><label>Subtítulo EN</label><textarea id="pc-subEn">${esc(c.subEn||'')}</textarea></div>
      <div class="field full"><label>WhatsApp (só o número, ex: 5521988902499)</label><input id="pc-whatsapp" value="${esc(c.whatsapp||'')}"></div>
    </div>`;
}

function renderPagVemai() {
  const v = (data.pagesData && data.pagesData.vemai) || {};
  document.getElementById('pagVemaiForm').innerHTML = `
    <div class="fields-grid">
      <div class="field"><label>Etiqueta PT</label><input id="pv-eyebrowPt" value="${esc(v.eyebrowPt||'')}"></div>
      <div class="field"><label>Etiqueta EN</label><input id="pv-eyebrowEn" value="${esc(v.eyebrowEn||'')}"></div>
      <div class="field"><label>Título PT</label><input id="pv-titlePt" value="${esc(v.titlePt||'')}"></div>
      <div class="field"><label>Título EN</label><input id="pv-titleEn" value="${esc(v.titleEn||'')}"></div>
      <div class="field full"><label>Frase PT <span class="field-note">aceita HTML — ex: Ele &lt;em&gt;acontece&lt;/em&gt;</span></label><textarea id="pv-statementPt">${esc(v.statementPt||'')}</textarea></div>
      <div class="field full"><label>Frase EN <span class="field-note">aceita HTML</span></label><textarea id="pv-statementEn">${esc(v.statementEn||'')}</textarea></div>
      <div class="field full"><label>Subtítulo PT</label><textarea id="pv-subPt">${esc(v.subPt||'')}</textarea></div>
      <div class="field full"><label>Subtítulo EN</label><textarea id="pv-subEn">${esc(v.subEn||'')}</textarea></div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════
   FESTIVAIS
══════════════════════════════════════════════════════════ */
function renderFestivais() {
  const items = data.historiaData.festivais || [];
  document.getElementById('festivalPanelCount').textContent = items.length + ' festivais';
  document.getElementById('festivaisList').innerHTML = items.map((f, i) => `
    <div class="card" id="festival-card-${i}">
      <div class="card-header" onclick="toggleCard('festival-card-${i}')">
        <div class="card-header-left">
          ${reorderBtns(i, items.length,
            `event.stopPropagation(); moveFestival(${i}, ${i-1})`,
            `event.stopPropagation(); moveFestival(${i}, ${i+1})`
          )}
          <span class="card-num">${String(i+1).padStart(2,'0')}</span>
          <span class="card-name">${f.name || '(sem nome)'}</span>
          <span class="card-meta">${f.year || ''}</span>
        </div>
        <span class="card-chevron">▼</span>
      </div>
      <div class="card-body">
        <div class="fields-grid">
          <div class="field"><label>Nome</label><input data-festival="${i}" data-key="name" value="${esc(f.name)}"></div>
          <div class="field"><label>Ano</label><input data-festival="${i}" data-key="year" value="${esc(f.year)}"></div>
          ${imgField('festival', i, 'logo', 'Logo', f.logo, 'recomendado PNG com fundo transparente · altura mín. 72 px · largura proporcional · exibido com altura máx. 36 px na grade')}
        </div>
        <div class="card-actions">
          <button class="btn btn-danger btn-small" onclick="removeFestival(${i})">Remover</button>
          <button class="btn btn-primary btn-small" onclick="saveCard('festival',${i})">Salvar</button>
        </div>
      </div>
    </div>`).join('');
}

function moveFestival(fromIdx, toIdx) {
  moveItem(data.historiaData.festivais, fromIdx, toIdx, renderFestivais);
}

function addFestival() {
  if (!data.historiaData.festivais) data.historiaData.festivais = [];
  data.historiaData.festivais.push({ name: '', year: '', logo: '' });
  renderFestivais();
  const idx = data.historiaData.festivais.length - 1;
  toggleCard(`festival-card-${idx}`);
  document.getElementById(`festival-card-${idx}`).scrollIntoView({ behavior: 'smooth' });
}

function removeFestival(i) {
  if (!confirm(`Remover "${data.historiaData.festivais[i].name || 'este festival'}"?`)) return;
  data.historiaData.festivais.splice(i, 1);
  renderFestivais();
}

/* ══════════════════════════════════════════════════════════
   PARCEIROS
══════════════════════════════════════════════════════════ */
function renderParceiros() {
  // Normaliza strings legadas para objetos
  data.historiaData.parceiros = (data.historiaData.parceiros || []).map(p =>
    typeof p === 'string' ? { name: p, logo: '' } : p
  );
  const parceiros = data.historiaData.parceiros;
  document.getElementById('parceirosForm').innerHTML =
    parceiros.map((p, i) => `
      <div class="card" id="parceiro-card-${i}">
        <div class="card-header" onclick="toggleCard('parceiro-card-${i}')">
          <div class="card-header-left">
            ${reorderBtns(i, parceiros.length,
              `event.stopPropagation(); moveParceiro(${i}, ${i-1})`,
              `event.stopPropagation(); moveParceiro(${i}, ${i+1})`
            )}
            <span class="card-num">${String(i+1).padStart(2,'0')}</span>
            <span class="card-name">${esc(p.name) || '(sem nome)'}</span>
          </div>
          <div style="display:flex;align-items:center;gap:0.5rem">
            <button class="btn btn-danger btn-small" onclick="event.stopPropagation();removeParceiro(${i})">Remover</button>
            <span class="card-chevron">▼</span>
          </div>
        </div>
        <div class="card-body">
          <div class="fields-grid">
            <div class="field full"><label>Nome</label><input data-parceiro="${i}" data-key="name" value="${esc(p.name)}"></div>
            ${imgField('parceiro', i, 'logo', 'Logo', p.logo, 'recomendado PNG com fundo transparente · proporção ~3:1 (horizontal) · mín. 200 px de largura')}
          </div>
        </div>
      </div>`).join('') +
    `<button class="add-btn" onclick="addParceiro()">+ adicionar parceiro</button>`;
}

function addParceiro() {
  if (!data.historiaData.parceiros) data.historiaData.parceiros = [];
  data.historiaData.parceiros.push({ name: '', logo: '' });
  renderParceiros();
  const idx = data.historiaData.parceiros.length - 1;
  toggleCard(`parceiro-card-${idx}`);
  document.getElementById(`parceiro-card-${idx}`).scrollIntoView({ behavior: 'smooth' });
}

function moveParceiro(fromIdx, toIdx) {
  moveItem(data.historiaData.parceiros, fromIdx, toIdx, renderParceiros);
}

function removeParceiro(i) {
  data.historiaData.parceiros.splice(i, 1);
  renderParceiros();
}

/* ══════════════════════════════════════════════════════════
   TAGS
══════════════════════════════════════════════════════════ */
function renderTags(tags, type, idx) {
  return (tags||[]).map((t, ti) => `
    <span class="tag-badge">${esc(t)}
      <button onclick="removeTag('${type}',${idx},${ti})">×</button>
    </span>`).join('');
}

function addTag(type, idx) {
  const input = document.getElementById(`tagInput-${type}-${idx}`);
  const val = input.value.trim();
  if (!val) return;
  if (type === 'film') {
    data.films[idx].tags = data.films[idx].tags || [];
    data.films[idx].tags.push(val);
    document.getElementById(`tags-film-${idx}`).innerHTML = renderTags(data.films[idx].tags, 'film', idx);
  }
  input.value = '';
}

function removeTag(type, idx, ti) {
  if (type === 'film') {
    data.films[idx].tags.splice(ti, 1);
    document.getElementById(`tags-film-${idx}`).innerHTML = renderTags(data.films[idx].tags, 'film', idx);
  }
}

/* ── STRIPE ITEMS ── */
function renderStripeItems(items) {
  if (!items.length) return '<p class="makingoff-empty">nenhum item ainda</p>';
  return items.map((t, i) => `
    <span class="tag-badge">${esc(t)}
      <button onclick="removeStripeItem(${i})">×</button>
    </span>`).join('');
}

function addStripeItem() {
  const input = document.getElementById('stripeItemInput');
  const val = input.value.trim();
  if (!val) return;
  if (!data.pagesData.index) data.pagesData.index = {};
  if (!Array.isArray(data.pagesData.index.stripeItems)) data.pagesData.index.stripeItems = [];
  data.pagesData.index.stripeItems.push(val);
  document.getElementById('stripeItemsList').innerHTML = renderStripeItems(data.pagesData.index.stripeItems);
  input.value = '';
}

function removeStripeItem(i) {
  if (!data.pagesData.index || !data.pagesData.index.stripeItems) return;
  data.pagesData.index.stripeItems.splice(i, 1);
  document.getElementById('stripeItemsList').innerHTML = renderStripeItems(data.pagesData.index.stripeItems);
}

/* ── TIPOGRAFIA ── */
function loadFontInAdmin(url) {
  if (!url || document.querySelector(`link[href="${url}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = url;
  document.head.appendChild(link);
}

function applyCustomFont(type) {
  const urlEl    = document.getElementById(type === 'display' ? 'ty-fontDisplayUrl'    : 'ty-fontUiUrl');
  const familyEl = document.getElementById(type === 'display' ? 'ty-fontDisplayFamily' : 'ty-fontUiFamily');
  const url    = urlEl?.value.trim();
  const family = familyEl?.value.trim();
  if (!data.siteData) data.siteData = {};
  if (url)    { loadFontInAdmin(url); data.siteData[type === 'display' ? 'fontDisplayUrl' : 'fontUiUrl'] = url; }
  if (family) {
    document.documentElement.style.setProperty(type === 'display' ? '--font-display' : '--font-ui', family);
    data.siteData[type === 'display' ? 'fontDisplayFamily' : 'fontUiFamily'] = family;
  }
  renderTipografia();
}

/* ── ESTILO (tema dark / light) ── */
function renderEstilo() {
  const theme = (data.siteData && data.siteData.theme) || 'dark';
  document.getElementById('estiloForm').innerHTML = `
    <p style="opacity:0.5;font-size:0.75rem;margin-bottom:1.5rem;line-height:1.6">
      Define o tema visual exibido para todos os visitantes do site.<br>
      A mudança entra em vigor após salvar no GitHub.
    </p>
    <div class="fields-grid">
      <div class="field">
        <label>Tema do site</label>
        <div style="display:flex;gap:12px;margin-top:4px">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="radio" name="siteTheme" id="theme-dark" value="dark" ${theme === 'dark' ? 'checked' : ''} onchange="previewTheme(this.value)">
            Escuro (dark)
          </label>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
            <input type="radio" name="siteTheme" id="theme-light" value="light" ${theme === 'light' ? 'checked' : ''} onchange="previewTheme(this.value)">
            Claro (light)
          </label>
        </div>
      </div>
    </div>
    <div class="panel-header" style="margin-top:2rem;border-bottom:none;padding-bottom:0"><span class="panel-title" style="font-size:14px">Pré-visualização</span></div>
    <div style="border:1px solid var(--border);border-radius:6px;padding:2rem;margin-top:0.5rem;display:flex;gap:2rem;align-items:center">
      <div id="estilo-preview-dark" style="flex:1;padding:1.5rem;border-radius:4px;background:#0a0a0a;color:#f0ece4;font-family:var(--font-display);font-size:1.1rem;font-weight:300">
        <div style="font-size:1.5rem;margin-bottom:0.5rem">pontos de fuga</div>
        <div style="font-size:0.75rem;opacity:0.5;font-family:var(--font-ui);letter-spacing:0.08em">Tema escuro</div>
      </div>
      <div id="estilo-preview-light" style="flex:1;padding:1.5rem;border-radius:4px;background:#f0ece4;color:#0a0a0a;font-family:var(--font-display);font-size:1.1rem;font-weight:300">
        <div style="font-size:1.5rem;margin-bottom:0.5rem">pontos de fuga</div>
        <div style="font-size:0.75rem;opacity:0.5;font-family:var(--font-ui);letter-spacing:0.08em">Tema claro</div>
      </div>
    </div>
  `;
}

function previewTheme(theme) {
  if (!data.siteData) data.siteData = {};
  data.siteData.theme = theme;
}

/* Fontes para títulos, manchetes e nome da produtora no menu */
const DISPLAY_PRESETS = [
  { name: 'Red Hat Mono', tag: 'padrão', url: 'https://fonts.googleapis.com/css2?family=Red+Hat+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap', family: "'Red Hat Mono', monospace" },
  { name: 'Fraunces',        url: 'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,300&display=swap', family: "'Fraunces', serif" },
  { name: 'Playfair Display', url: 'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;1,400&display=swap', family: "'Playfair Display', serif" },
  { name: 'Cormorant Garamond', url: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300;1,400&display=swap', family: "'Cormorant Garamond', serif" },
  { name: 'DM Serif Display', url: 'https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&display=swap', family: "'DM Serif Display', serif" },
  { name: 'Cinzel',          url: 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500&display=swap', family: "'Cinzel', serif" },
  { name: 'Bebas Neue',      url: 'https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap', family: "'Bebas Neue', sans-serif" },
  { name: 'Josefin Sans',    url: 'https://fonts.googleapis.com/css2?family=Josefin+Sans:wght@300;400;600&display=swap', family: "'Josefin Sans', sans-serif" },
  { name: 'Spectral',        url: 'https://fonts.googleapis.com/css2?family=Spectral:ital,wght@0,300;0,400;1,300;1,400&display=swap', family: "'Spectral', serif" },
  { name: 'Italiana',        url: 'https://fonts.googleapis.com/css2?family=Italiana&display=swap', family: "'Italiana', serif" },
  { name: 'Bodoni Moda',     url: 'https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,opsz,wght@0,6..96,300;0,6..96,400;1,6..96,300&display=swap', family: "'Bodoni Moda', serif" },
  { name: 'Lora',            url: 'https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,500;1,400&display=swap', family: "'Lora', serif" },
];

/* Fontes para corpo de texto, botões, labels e navegação */
const UI_PRESETS = [
  { name: 'Red Hat Mono',  tag: 'padrão', url: 'https://fonts.googleapis.com/css2?family=Red+Hat+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap', family: "'Red Hat Mono', monospace" },
  { name: 'Space Grotesk', url: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500&display=swap', family: "'Space Grotesk', sans-serif" },
  { name: 'Inter',         url: 'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap', family: "'Inter', sans-serif" },
  { name: 'Jost',          url: 'https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500&display=swap', family: "'Jost', sans-serif" },
  { name: 'DM Sans',       url: 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&display=swap', family: "'DM Sans', sans-serif" },
  { name: 'Raleway',       url: 'https://fonts.googleapis.com/css2?family=Raleway:wght@300;400;500&display=swap', family: "'Raleway', sans-serif" },
  { name: 'Barlow',        url: 'https://fonts.googleapis.com/css2?family=Barlow:wght@300;400;500&display=swap', family: "'Barlow', sans-serif" },
  { name: 'Lato',          url: 'https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap', family: "'Lato', sans-serif" },
  { name: 'Karla',         url: 'https://fonts.googleapis.com/css2?family=Karla:wght@300;400;500&display=swap', family: "'Karla', sans-serif" },
  { name: 'Open Sans',     url: 'https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;500&display=swap', family: "'Open Sans', sans-serif" },
  { name: 'Nunito Sans',   url: 'https://fonts.googleapis.com/css2?family=Nunito+Sans:wght@300;400;500&display=swap', family: "'Nunito Sans', sans-serif" },
  { name: 'Source Sans 3', url: 'https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@300;400;500&display=swap', family: "'Source Sans 3', sans-serif" },
];

let _tyCustomOpen = false;

function _fontName(family, presets) {
  const match = presets.find(p => p.family === family);
  return match ? match.name : family.replace(/['"]/g, '').split(',')[0].trim();
}

function buildFontCards(presets, activeFam, onclickFn) {
  return presets.map((p, i) => {
    const active = activeFam === p.family;
    return `<div class="font-preset-card${active ? ' font-preset-active' : ''}" onclick="${onclickFn}(${i})">
      <div class="font-preset-sample" style="font-family:${p.family}">${p.sample || 'pontos de fuga'}</div>
      <div class="font-preset-name">${p.name}</div>
      ${p.tag ? `<span class="font-preset-tag">${p.tag}</span>` : ''}
    </div>`;
  }).join('');
}

function renderTipografia() {
  const sd = data.siteData || {};
  const dispFam = sd.fontDisplayFamily || DISPLAY_PRESETS[0].family;
  const uiFam   = sd.fontUiFamily      || UI_PRESETS[0].family;

  if (sd.fontDisplayUrl)  loadFontInAdmin(sd.fontDisplayUrl);
  if (dispFam)            document.documentElement.style.setProperty('--font-display', dispFam);
  if (sd.fontUiUrl)       loadFontInAdmin(sd.fontUiUrl);
  if (uiFam)              document.documentElement.style.setProperty('--font-ui', uiFam);

  DISPLAY_PRESETS.forEach(p => loadFontInAdmin(p.url));
  UI_PRESETS.forEach(p => loadFontInAdmin(p.url));

  const dispIsPreset = DISPLAY_PRESETS.some(p => p.family === dispFam);
  const uiIsPreset   = UI_PRESETS.some(p => p.family === uiFam);
  if (!dispIsPreset || !uiIsPreset) _tyCustomOpen = true;

  // Atualiza subtítulo do cabeçalho do painel
  const panelHeader = document.querySelector('#panel-tipografia .panel-header');
  if (panelHeader) {
    const dName = escHtml(_fontName(dispFam, DISPLAY_PRESETS));
    const uName = escHtml(_fontName(uiFam, UI_PRESETS));
    panelHeader.innerHTML = `
      <span class="panel-title">Tipografia</span>
      <span style="font-family:var(--mono);font-size:0.6rem;opacity:0.38;letter-spacing:0.03em;line-height:1">
        display: ${dName} &nbsp;·&nbsp; interface: ${uName}
      </span>`;
  }

  const customHtml = _tyCustomOpen ? `
    <div class="panel-header" style="padding-top:1.25rem;border-top:1px solid var(--border);border-bottom:none;padding-bottom:0;margin-bottom:0">
      <span class="panel-title" style="font-size:14px">Personalizado</span>
      <button class="btn btn-ghost btn-small" onclick="toggleTyCustom()" style="opacity:0.45;font-size:0.68rem;padding:0.2rem 0.5rem">fechar ✕</button>
    </div>
    <p class="font-type-desc" style="margin-top:0.5rem">Use qualquer fonte do Google Fonts ou outra URL externa.</p>
    <div class="fields-grid">
      <div class="field">
        <label>Display — URL</label>
        <input id="ty-fontDisplayUrl" value="${escHtml(sd.fontDisplayUrl || '')}" placeholder="https://fonts.googleapis.com/css2?family=…">
      </div>
      <div class="field">
        <label>Display — font-family CSS</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="ty-fontDisplayFamily" value="${escHtml(sd.fontDisplayFamily || '')}" placeholder="'Fraunces', serif" style="flex:1">
          <button class="btn btn-secondary btn-small" onclick="applyCustomFont('display')">Aplicar</button>
        </div>
      </div>
      <div class="field">
        <label>Interface — URL</label>
        <input id="ty-fontUiUrl" value="${escHtml(sd.fontUiUrl || '')}" placeholder="https://fonts.googleapis.com/css2?family=…">
      </div>
      <div class="field">
        <label>Interface — font-family CSS</label>
        <div style="display:flex;gap:8px;align-items:center">
          <input id="ty-fontUiFamily" value="${escHtml(sd.fontUiFamily || '')}" placeholder="'Space Grotesk', sans-serif" style="flex:1">
          <button class="btn btn-secondary btn-small" onclick="applyCustomFont('ui')">Aplicar</button>
        </div>
      </div>
    </div>` : `
    <div style="padding-top:1.25rem;border-top:1px solid var(--border)">
      <button class="btn btn-secondary btn-small" onclick="toggleTyCustom()">+ Fonte personalizada</button>
    </div>`;

  document.getElementById('tipografiaForm').innerHTML = `
    <style>
      .font-preset-card{padding:0.9rem 1rem;border-radius:4px;cursor:pointer;border:1px solid var(--border);background:var(--bg-2);transition:border-color .15s,background .15s;position:relative;overflow:hidden}
      .font-preset-card:hover{border-color:rgba(255,255,255,0.35)}
      .font-preset-card.font-preset-active{border-color:var(--accent);background:rgba(201,168,76,0.07)}
      .font-preset-sample{font-size:1.05rem;font-weight:300;line-height:1.2;margin-bottom:0.3rem;color:var(--white)}
      .font-preset-name{font-size:0.58rem;letter-spacing:0.06em;opacity:0.4;text-transform:uppercase;font-family:var(--mono)}
      .font-preset-tag{position:absolute;top:6px;right:6px;font-size:0.48rem;letter-spacing:0.1em;text-transform:uppercase;background:var(--accent);color:var(--black);padding:2px 5px;border-radius:2px;font-family:var(--mono)}
      .font-type-desc{font-size:0.72rem;opacity:0.55;line-height:1.5;margin-bottom:0.85rem}
    </style>

    <div class="panel-header" style="margin-top:0;margin-bottom:0.6rem;border-bottom:none;padding-bottom:0">
      <span class="panel-title" style="font-size:14px">Display</span>
    </div>
    <p class="font-type-desc">Títulos, nome da produtora, manchetes — a fonte que define a <em>personalidade</em> visual do site.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:2rem">
      ${buildFontCards(DISPLAY_PRESETS, dispFam, 'applyDisplayPreset')}
    </div>

    <div class="panel-header" style="padding-top:1.25rem;border-top:1px solid var(--border);border-bottom:none;padding-bottom:0;margin-bottom:0.6rem">
      <span class="panel-title" style="font-size:14px">Interface</span>
    </div>
    <p class="font-type-desc">Corpo de texto, botões, labels, navegação — deve ser <em>legível e neutro</em>, sem competir com o display.</p>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:2rem">
      ${buildFontCards(UI_PRESETS.map(p => ({...p, sample: 'produtora · cinema'})), uiFam, 'applyUiPreset')}
    </div>

    ${customHtml}

    <div class="panel-header" style="margin-top:2rem;border-bottom:none;padding-bottom:0"><span class="panel-title" style="font-size:14px">Pré-visualização</span></div>
    <div style="border:1px solid var(--border);border-radius:6px;padding:2rem;margin-top:0.5rem">
      <p style="font-family:var(--font-display);font-size:2.5rem;font-weight:300;line-height:1.1;margin-bottom:0.75rem">pontos de fuga</p>
      <p style="font-family:var(--font-display);font-size:1.1rem;font-style:italic;font-weight:300;margin-bottom:1.5rem;opacity:0.6">Cinema que abre espaço para o que não cabe em palavras</p>
      <p style="font-family:var(--font-ui);font-size:0.85rem;letter-spacing:0.04em;line-height:1.8;opacity:0.7">Texto de interface · labels · botões · navegação · corpo de texto em parágrafos corridos.</p>
      <div style="display:flex;gap:12px;margin-top:1.25rem">
        <span style="font-family:var(--font-ui);font-size:0.7rem;letter-spacing:0.14em;text-transform:uppercase;border:1px solid var(--border);padding:6px 14px;border-radius:2px">Ver produções</span>
        <span style="font-family:var(--font-ui);font-size:0.7rem;letter-spacing:0.14em;text-transform:uppercase;background:var(--gold);color:var(--black);padding:6px 14px;border-radius:2px">Entrar em contato</span>
      </div>
    </div>
  `;
}

function toggleTyCustom() {
  _tyCustomOpen = !_tyCustomOpen;
  renderTipografia();
}

function applyDisplayPreset(idx) {
  const p = DISPLAY_PRESETS[idx];
  if (!data.siteData) data.siteData = {};
  data.siteData.fontDisplayUrl    = p.url;
  data.siteData.fontDisplayFamily = p.family;
  loadFontInAdmin(p.url);
  document.documentElement.style.setProperty('--font-display', p.family);
  const uiFam = data.siteData.fontUiFamily || UI_PRESETS[0].family;
  if (UI_PRESETS.some(q => q.family === uiFam)) _tyCustomOpen = false;
  renderTipografia();
}

function applyUiPreset(idx) {
  const p = UI_PRESETS[idx];
  if (!data.siteData) data.siteData = {};
  data.siteData.fontUiUrl    = p.url;
  data.siteData.fontUiFamily = p.family;
  loadFontInAdmin(p.url);
  document.documentElement.style.setProperty('--font-ui', p.family);
  const dispFam = data.siteData.fontDisplayFamily || DISPLAY_PRESETS[0].family;
  if (DISPLAY_PRESETS.some(q => q.family === dispFam)) _tyCustomOpen = false;
  renderTipografia();
}

/* ── LINKS (redes sociais / links globais) ── */
function renderLinks() {
  const links = (data.siteData && data.siteData.socialLinks) || [];
  document.getElementById('linksForm').innerHTML = `
    <p style="font-family:var(--mono);font-size:0.72rem;color:var(--muted);line-height:1.8;margin-bottom:2rem;padding-bottom:1.25rem;border-bottom:1px solid var(--border-f)">
      Estes links aparecem no <strong style="color:var(--white)">rodapé</strong> e no <strong style="color:var(--white)">menu</strong> de todas as páginas do site.<br>
      O campo <strong style="color:var(--accent)">Nome</strong> é o texto exibido; o campo <strong style="color:var(--accent)">URL</strong> é o endereço completo.
    </p>

    <div style="display:grid;grid-template-columns:1fr 2fr auto;gap:0;margin-bottom:0.25rem">
      <span style="font-family:var(--mono);font-size:0.6rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);padding:0 0 0.4rem 1rem">Nome</span>
      <span style="font-family:var(--mono);font-size:0.6rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);padding:0 0 0.4rem 1rem">URL</span>
      <span></span>
    </div>

    <div id="socialLinksList">${renderSocialLinksList(links)}</div>

    <div style="margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--border-f)">
      <p style="font-family:var(--mono);font-size:0.6rem;letter-spacing:0.14em;text-transform:uppercase;color:var(--muted);margin-bottom:0.75rem">Adicionar link</p>
      <div style="display:grid;grid-template-columns:1fr 2fr auto;gap:8px;align-items:center">
        <input id="socialLinkLabel" class="adm-input" placeholder="ex: Instagram"
               onkeydown="if(event.key==='Enter'){addSocialLink();event.preventDefault()}">
        <input id="socialLinkUrl" class="adm-input" placeholder="ex: https://instagram.com/..."
               onkeydown="if(event.key==='Enter'){addSocialLink();event.preventDefault()}">
        <button class="btn btn-secondary btn-small" onclick="addSocialLink()" style="white-space:nowrap">+ adicionar</button>
      </div>
    </div>`;
}

function renderSocialLinksList(links) {
  if (!links.length) return '<p class="makingoff-empty" style="grid-column:1/-1">nenhum link ainda</p>';
  return '<div style="display:flex;flex-direction:column;gap:4px">' +
    links.map((l, i) => `
      <div style="display:grid;grid-template-columns:1fr 2fr auto;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--border-f)">
        <input class="adm-input" placeholder="Nome" value="${esc(l.label||'')}"
               oninput="updateSocialLink(${i},'label',this.value)">
        <input class="adm-input" placeholder="URL" value="${esc(l.url||'')}"
               oninput="updateSocialLink(${i},'url',this.value)">
        <button class="btn btn-ghost btn-small" onclick="removeSocialLink(${i})" title="remover"
                style="justify-self:center;padding:0.35rem 0.6rem;opacity:0.5;transition:opacity 0.2s"
                onmouseenter="this.style.opacity='1'" onmouseleave="this.style.opacity='0.5'">✕</button>
      </div>`).join('') +
    '</div>';
}

function addSocialLink() {
  const labelEl = document.getElementById('socialLinkLabel');
  const urlEl   = document.getElementById('socialLinkUrl');
  const label   = labelEl.value.trim();
  const url     = urlEl.value.trim();
  if (!label || !url) return;
  if (!data.siteData) data.siteData = {};
  if (!Array.isArray(data.siteData.socialLinks)) data.siteData.socialLinks = [];
  data.siteData.socialLinks.push({ label, url });
  document.getElementById('socialLinksList').innerHTML = renderSocialLinksList(data.siteData.socialLinks);
  labelEl.value = '';
  urlEl.value   = '';
}

function removeSocialLink(i) {
  if (!data.siteData || !Array.isArray(data.siteData.socialLinks)) return;
  data.siteData.socialLinks.splice(i, 1);
  document.getElementById('socialLinksList').innerHTML = renderSocialLinksList(data.siteData.socialLinks);
}

function updateSocialLink(i, key, value) {
  if (!data.siteData || !Array.isArray(data.siteData.socialLinks)) return;
  if (data.siteData.socialLinks[i]) data.siteData.socialLinks[i][key] = value;
}

/* ══════════════════════════════════════════════════════════
   COLLECT ALL
══════════════════════════════════════════════════════════ */
function collectAll() {
  if (!data.siteData) data.siteData = {};
  document.querySelectorAll('[data-sitedata]').forEach(el => {
    data.siteData[el.dataset.key] = el.value;
  });
  const tyDisplayUrl    = document.getElementById('ty-fontDisplayUrl');
  const tyDisplayFamily = document.getElementById('ty-fontDisplayFamily');
  const tyUiUrl         = document.getElementById('ty-fontUiUrl');
  const tyUiFamily      = document.getElementById('ty-fontUiFamily');
  const themeRadio = document.querySelector('input[name="siteTheme"]:checked');
  if (themeRadio) data.siteData.theme = themeRadio.value;
  if (tyDisplayUrl)    data.siteData.fontDisplayUrl    = tyDisplayUrl.value.trim();
  if (tyDisplayFamily) data.siteData.fontDisplayFamily = tyDisplayFamily.value.trim();
  if (tyUiUrl)         data.siteData.fontUiUrl         = tyUiUrl.value.trim();
  if (tyUiFamily)      data.siteData.fontUiFamily      = tyUiFamily.value.trim();
  document.querySelectorAll('[data-film]').forEach(el => {
    const i = +el.dataset.film, key = el.dataset.key;
    if (!data.films[i]) return;
    data.films[i][key] = el.type === 'checkbox' ? el.checked : el.value;
  });
  document.querySelectorAll('[data-other]').forEach(el => {
    const i = +el.dataset.other, key = el.dataset.key;
    if (!data.otherProductions || !data.otherProductions[i]) return;
    data.otherProductions[i][key] = el.value;
  });
  document.querySelectorAll('[data-upcoming]').forEach(el => {
    const i = +el.dataset.upcoming, key = el.dataset.key;
    if (!data.upcomingFilms[i]) return;
    data.upcomingFilms[i][key] = el.value;
  });
  ['eyebrow','eyebrowEn','title1','title1En','title2','title2En','p1','p1En','p2','p2En']
    .forEach(f => {
      const el = document.getElementById('m-' + f);
      if (el) data.historiaData.manifesto[f] = el.value;
    });
  if (!data.pagesData) data.pagesData = {};
  if (!data.pagesData) data.pagesData = {};
  if (!data.pagesData.producoes) data.pagesData.producoes = {};
  ['titlePt','titleEn'].forEach(f => {
    const el = document.getElementById('pp-' + f);
    if (el) data.pagesData.producoes[f] = el.value;
  });
  if (!data.pagesData.contato) data.pagesData.contato = {};
  ['eyebrowPt','eyebrowEn','titlePt','titleEn','subPt','subEn','whatsapp'].forEach(f => {
    const el = document.getElementById('pc-' + f);
    if (el) data.pagesData.contato[f] = el.value;
  });
  if (!data.pagesData.vemai) data.pagesData.vemai = {};
  ['eyebrowPt','eyebrowEn','titlePt','titleEn','statementPt','statementEn','subPt','subEn'].forEach(f => {
    const el = document.getElementById('pv-' + f);
    if (el) data.pagesData.vemai[f] = el.value;
  });
  if (!data.pagesData.index) data.pagesData.index = {};
  ['ctaTitlePt','ctaTitleEn','ctaBodyPt','ctaBodyEn','heroLabelPt','heroLabelEn','gridTitlePt','gridTitleEn'].forEach(f => {
    const el = document.getElementById('ix-' + f);
    if (el) data.pagesData.index[f] = el.value;
  });
  // stripeItems são geridos diretamente em data.pagesData.index.stripeItems via add/removeStripeItem
  // socialLinks são geridos diretamente em data.siteData.socialLinks via add/remove/updateSocialLink
  if (!data.pagesData.historia) data.pagesData.historia = {};
  ['festivaisEyebrowPt','festivaisEyebrowEn',
   'parceirosEyebrowPt','parceirosEyebrowEn'].forEach(f => {
    const el = document.getElementById('h-' + f);
    if (el) data.pagesData.historia[f] = el.value;
  });
  document.querySelectorAll('[data-parceiro]').forEach(el => {
    const i = +el.dataset.parceiro, key = el.dataset.key;
    if (!data.historiaData.parceiros[i]) return;
    data.historiaData.parceiros[i][key] = el.value;
  });
  document.querySelectorAll('[data-festival]').forEach(el => {
    const i = +el.dataset.festival, key = el.dataset.key;
    if (!data.historiaData.festivais[i]) return;
    data.historiaData.festivais[i][key] = el.value;
  });
}

/* ══════════════════════════════════════════════════════════
   IMAGE UPLOAD
══════════════════════════════════════════════════════════ */

/* Gera o HTML do campo de imagem — só upload, sem input de URL */
function imgField(dataAttr, idx, key, labelText, currentVal, hint = '') {
  const fieldId   = `img-${dataAttr}-${idx}-${key}`;
  const previewId = `prev-${dataAttr}-${idx}-${key}`;
  const btnText   = currentVal ? '↑ substituir' : '↑ enviar';
  return `
    <div class="field full">
      <label>${labelText}</label>
      <input type="hidden" id="${fieldId}" data-${dataAttr}="${idx}" data-key="${key}" value="${esc(currentVal)}">
      <div class="img-field-row">
        <img id="${previewId}" class="img-field-thumb"
             src="${esc(currentVal)}" style="${currentVal ? '' : 'display:none'}"
             onerror="this.style.display='none'">
        <div class="asset-btns">
          <label class="upload-label">
            <span class="upload-label-text">${btnText}</span>
            <input type="file" accept="image/*" onchange="uploadImage(this,'${fieldId}','${previewId}')">
          </label>
          ${currentVal ? `
          <a class="btn btn-small asset-btn-dl" href="${esc(currentVal)}" download target="_blank">↓ baixar</a>
          <button class="btn btn-danger btn-small" onclick="removeAsset('${fieldId}','${previewId}')">✕ remover</button>` : ''}
        </div>
      </div>
      ${hint ? `<p class="img-size-hint">${hint}</p>` : ''}
    </div>`;
}

/* Gera o HTML do campo de vídeo hover com botão de upload */
function videoField(dataAttr, idx, key, labelText, currentVal, note = '') {
  const fieldId   = `img-${dataAttr}-${idx}-${key}`;
  const previewId = `prev-${dataAttr}-${idx}-${key}`;
  const btnText   = currentVal ? '↑ substituir' : '↑ enviar';
  return `
    <div class="field full">
      <label>${labelText}${note ? `<span class="field-note">${note}</span>` : ''}</label>
      <input type="hidden" id="${fieldId}" data-${dataAttr}="${idx}" data-key="${key}" value="${esc(currentVal)}">
      <div class="img-field-row">
        <video id="${previewId}" class="img-field-thumb"
               src="${esc(currentVal)}" style="${currentVal ? '' : 'display:none'}" muted></video>
        <div class="asset-btns">
          <label class="upload-label">
            <span class="upload-label-text">${btnText}</span>
            <input type="file" accept="video/mp4,video/*" onchange="uploadImage(this,'${fieldId}','${previewId}')">
          </label>
          ${currentVal ? `
          <a class="btn btn-small asset-btn-dl" href="${esc(currentVal)}" download target="_blank">↓ baixar</a>
          <button class="btn btn-danger btn-small" onclick="removeAsset('${fieldId}','${previewId}')">✕ remover</button>` : ''}
        </div>
      </div>
    </div>`;
}

/* Campo de vídeo com upload E URL (YouTube/Vimeo) */
function isEmbedUrl(val) {
  return val && (val.includes('youtube') || val.includes('youtu.be') || val.includes('vimeo'));
}

function videoFieldWithUrl(dataAttr, idx, key, labelText, currentVal, note = '') {
  const fieldId   = `img-${dataAttr}-${idx}-${key}`;
  const previewId = `prev-${dataAttr}-${idx}-${key}`;
  const hasEmbed  = isEmbedUrl(currentVal);
  const hasFile   = currentVal && !hasEmbed;
  const btnText   = hasFile ? '↑ substituir' : '↑ enviar arquivo';
  return `
    <div class="field full">
      <label>${labelText}${note ? `<span class="field-note">${note}</span>` : ''}</label>
      <input type="hidden" id="${fieldId}" data-${dataAttr}="${idx}" data-key="${key}" value="${esc(currentVal)}">
      <div class="video-option${hasFile ? ' video-option--disabled' : ''}" id="opt-url-${fieldId}">
        <span class="video-option__label">URL</span>
        <input type="text" id="url-${fieldId}" class="video-url-input"
               placeholder="YouTube ou Vimeo…"
               value="${esc(hasEmbed ? currentVal : '')}"
               ${hasFile ? 'disabled' : ''}
               oninput="syncVideoUrl(this,'${fieldId}','${previewId}')">
      </div>
      <div class="video-field-sep">ou</div>
      <div class="video-option${hasEmbed ? ' video-option--disabled' : ''}" id="opt-file-${fieldId}">
        <span class="video-option__label">Arquivo</span>
        <div class="img-field-row">
          <video id="${previewId}" class="img-field-thumb"
                 src="${esc(hasFile ? currentVal : '')}"
                 style="${hasFile ? '' : 'display:none'}" muted></video>
          <div class="asset-btns">
            <label class="upload-label">
              <span class="upload-label-text">${btnText}</span>
              <input type="file" accept="video/mp4,video/*" ${hasEmbed ? 'disabled' : ''}
                     onchange="uploadVideoFile(this,'${fieldId}','${previewId}')">
            </label>
            <span class="field-note" style="margin-left:0">máximo 100 MB</span>
            ${hasFile ? `
            <a class="btn btn-small asset-btn-dl" href="${esc(currentVal)}" download target="_blank">↓ baixar</a>
            <button class="btn btn-danger btn-small" onclick="removeVideoAsset('${fieldId}','${previewId}')">✕ remover</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
}

function setVideoExclusive(fieldId, active) {
  const urlOpt   = document.getElementById('opt-url-'  + fieldId);
  const fileOpt  = document.getElementById('opt-file-' + fieldId);
  const urlInput = document.getElementById('url-' + fieldId);
  const fileInput = fileOpt ? fileOpt.querySelector('input[type="file"]') : null;
  if (active === 'url') {
    urlOpt?.classList.remove('video-option--disabled');
    fileOpt?.classList.add('video-option--disabled');
    if (fileInput) fileInput.disabled = true;
    if (urlInput)  urlInput.disabled  = false;
  } else if (active === 'file') {
    fileOpt?.classList.remove('video-option--disabled');
    urlOpt?.classList.add('video-option--disabled');
    if (urlInput)  urlInput.disabled  = true;
    if (fileInput) fileInput.disabled = false;
  } else {
    urlOpt?.classList.remove('video-option--disabled');
    fileOpt?.classList.remove('video-option--disabled');
    if (urlInput)  urlInput.disabled  = false;
    if (fileInput) fileInput.disabled = false;
  }
}

function syncVideoUrl(input, fieldId, previewId) {
  const val   = input.value.trim();
  const field = document.getElementById(fieldId);
  field.value = val;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  const thumb = document.getElementById(previewId);
  if (thumb) { thumb.src = ''; thumb.style.display = 'none'; }
  setVideoExclusive(fieldId, val ? 'url' : null);
}

async function uploadVideoFile(fileInput, targetFieldId, previewId) {
  const urlInput = document.getElementById('url-' + targetFieldId);
  if (urlInput) urlInput.value = '';
  await uploadImage(fileInput, targetFieldId, previewId);
  setVideoExclusive(targetFieldId, 'file');
}

async function removeVideoAsset(fieldId, previewId) {
  await removeAsset(fieldId, previewId);
  setVideoExclusive(fieldId, null);
}

/* ── FICHA TÉCNICA / ELENCO ── */
function crewField(section, dataAttr, idx, items, labelText) {
  const list = Array.isArray(items) ? items : [];
  return `
    <div class="field full">
      <label>${labelText}</label>
      <div id="${section}-list-${dataAttr}-${idx}">
        ${renderCrewItems(section, dataAttr, idx, list)}
      </div>
      <button class="btn btn-secondary btn-small" style="margin-top:0.5rem"
              onclick="addCrewItem('${section}','${dataAttr}',${idx})">+ adicionar</button>
    </div>`;
}

function renderCrewItems(section, dataAttr, idx, items) {
  if (!items.length) return '<p class="makingoff-empty">nenhum integrante ainda</p>';
  return items.map((item, j) => `
    <div class="crew-row">
      <input type="text" placeholder="Função" value="${esc(item.role||'')}"
             oninput="updateCrewItem('${section}','${dataAttr}',${idx},${j},'role',this.value)">
      <input type="text" placeholder="Nome" value="${esc(item.name||'')}"
             oninput="updateCrewItem('${section}','${dataAttr}',${idx},${j},'name',this.value)">
      <button class="btn btn-danger btn-small" onclick="removeCrewItem('${section}','${dataAttr}',${idx},${j})">✕</button>
    </div>`).join('');
}

function updateCrewItem(section, dataAttr, idx, j, field, val) {
  const source = getTrailerSource(dataAttr);
  const key    = section === 'ficha' ? 'fichatecnica' : 'elenco';
  if (!Array.isArray(source[idx][key])) source[idx][key] = [];
  if (!source[idx][key][j]) source[idx][key][j] = { role:'', name:'' };
  source[idx][key][j][field] = val;
}

function addCrewItem(section, dataAttr, idx) {
  const source = getTrailerSource(dataAttr);
  const key    = section === 'ficha' ? 'fichatecnica' : 'elenco';
  if (!Array.isArray(source[idx][key])) source[idx][key] = [];
  source[idx][key].push({ role:'', name:'' });
  const list = document.getElementById(`${section}-list-${dataAttr}-${idx}`);
  if (list) list.innerHTML = renderCrewItems(section, dataAttr, idx, source[idx][key]);
}

function removeCrewItem(section, dataAttr, idx, j) {
  const source = getTrailerSource(dataAttr);
  const key    = section === 'ficha' ? 'fichatecnica' : 'elenco';
  source[idx][key].splice(j, 1);
  const list = document.getElementById(`${section}-list-${dataAttr}-${idx}`);
  if (list) list.innerHTML = renderCrewItems(section, dataAttr, idx, source[idx][key]);
}

/* ── PREVIEW — campo único (URL ou arquivo) ── */
function previewField(dataAttr, idx, currentVal) {
  return `
    <div class="field full">
      <label>Preview<span class="field-note">máx 15 s · proporção 3:4 (retrato) · mesmo formato da imagem de capa</span></label>
      <div id="preview-content-${dataAttr}-${idx}">
        ${renderPreviewContent(dataAttr, idx, currentVal)}
      </div>
    </div>`;
}

function renderPreviewContent(dataAttr, idx, currentVal) {
  if (!currentVal) {
    return `<p class="makingoff-empty">nenhum preview ainda</p>
      <div style="text-align:center;margin-top:0.75rem">
        <button class="btn btn-secondary btn-small" onclick="showPreviewSlot('${dataAttr}',${idx})">+ adicionar preview</button>
      </div>`;
  }
  const fieldId   = `img-${dataAttr}-${idx}-videoHover`;
  const previewId = `prev-${dataAttr}-${idx}-videoHover`;
  const hasEmbed  = isEmbedUrl(currentVal);
  const hasFile   = currentVal && !hasEmbed;
  const btnText   = hasFile ? '↑ substituir' : '↑ enviar arquivo';
  return `
    <input type="hidden" id="${fieldId}" data-${dataAttr}="${idx}" data-key="videoHover" value="${esc(currentVal)}">
    <div class="video-option${hasFile ? ' video-option--disabled' : ''}" id="opt-url-${fieldId}">
      <span class="video-option__label">URL</span>
      <input type="text" id="url-${fieldId}" class="video-url-input"
             placeholder="YouTube ou Vimeo…"
             value="${esc(hasEmbed ? currentVal : '')}"
             ${hasFile ? 'disabled' : ''}
             oninput="syncVideoUrl(this,'${fieldId}','${previewId}')">
    </div>
    <div class="video-field-sep">ou</div>
    <div class="video-option${hasEmbed ? ' video-option--disabled' : ''}" id="opt-file-${fieldId}">
      <span class="video-option__label">Arquivo</span>
      <div class="img-field-row">
        <video id="${previewId}" class="img-field-thumb"
               src="${esc(hasFile ? currentVal : '')}"
               style="${hasFile ? '' : 'display:none'}" muted></video>
        <div class="asset-btns">
          <label class="upload-label">
            <span class="upload-label-text">${btnText}</span>
            <input type="file" accept="video/mp4,video/*" ${hasEmbed ? 'disabled' : ''}
                   onchange="uploadVideoFile(this,'${fieldId}','${previewId}')">
          </label>
          <span class="field-note" style="margin-left:0">máximo 100 MB</span>
          ${hasFile ? `
          <a class="btn btn-small asset-btn-dl" href="${esc(currentVal)}" download target="_blank">↓ baixar</a>` : ''}
        </div>
      </div>
    </div>
    <p class="img-size-hint" style="margin-bottom:0.25rem">arquivo: proporção 3:4 (retrato) · mesmo recorte da imagem de capa · máx. 100 MB · formato MP4</p>
    <div style="text-align:right;margin-top:0.25rem">
      <button class="btn btn-danger btn-small" onclick="removePreview('${dataAttr}',${idx})">✕ remover preview</button>
    </div>`;
}

function showPreviewSlot(dataAttr, idx) {
  const content = document.getElementById(`preview-content-${dataAttr}-${idx}`);
  if (content) content.innerHTML = renderPreviewContent(dataAttr, idx, '');
}

async function removePreview(dataAttr, idx) {
  if (!confirm('Remover este preview do GitHub?')) return;
  const source  = dataAttr === 'film' ? data.films : dataAttr === 'other' ? data.otherProductions : data.upcomingFilms;
  const fieldId = `img-${dataAttr}-${idx}-videoHover`;
  const field   = document.getElementById(fieldId);
  const url     = field ? field.value : (source[idx].videoHover || '');
  const rawBase = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
  if (url && url.startsWith(rawBase)) {
    const path = url.replace(rawBase, '').split('?')[0];
    try { const f = await ghGet(path); await ghDelete(path, f.sha, `assets: remove ${path}`); } catch {}
  }
  source[idx].videoHover = '';
  const content = document.getElementById(`preview-content-${dataAttr}-${idx}`);
  if (content) content.innerHTML = renderPreviewContent(dataAttr, idx, '');
  toast('Preview removido.', 'ok');
}

/* ── TRAILERS — lista de trailers (URL ou arquivo) ── */
function getTrailerSource(dataAttr) {
  return dataAttr === 'film' ? data.films
       : dataAttr === 'other' ? data.otherProductions
       : data.upcomingFilms;
}

function trailersField(dataAttr, idx, trailers) {
  const items = Array.isArray(trailers) ? trailers : [];
  return `
    <div class="field full">
      <label>Trailers</label>
      <div id="trailers-list-${dataAttr}-${idx}">
        ${items.length
          ? items.map((url, s) => renderTrailerSlot(dataAttr, idx, s, url)).join('')
          : '<p class="makingoff-empty">nenhum trailer ainda</p>'}
      </div>
      <div style="text-align:center;margin-top:0.75rem">
        <button class="btn btn-secondary btn-small" onclick="addTrailerSlot('${dataAttr}',${idx})">+ adicionar trailer</button>
      </div>
    </div>`;
}

function renderTrailerSlot(dataAttr, idx, slotIdx, currentVal) {
  const slotId    = `trailer-${dataAttr}-${idx}-${slotIdx}`;
  const previewId = `tprev-${dataAttr}-${idx}-${slotIdx}`;
  const hasEmbed  = isEmbedUrl(currentVal);
  const hasFile   = currentVal && !hasEmbed;
  const btnText   = hasFile ? '↑ substituir' : '↑ enviar arquivo';
  return `
    <div class="trailer-slot" id="${slotId}">
      <div class="video-option${hasFile ? ' video-option--disabled' : ''}" id="ts-url-${slotId}">
        <span class="video-option__label">URL</span>
        <input type="text" class="video-url-input"
               placeholder="YouTube ou Vimeo…"
               value="${esc(hasEmbed ? currentVal : '')}"
               ${hasFile ? 'disabled' : ''}
               oninput="syncTrailerUrl(this,'${dataAttr}',${idx},${slotIdx})">
      </div>
      <div class="video-field-sep">ou</div>
      <div class="video-option${hasEmbed ? ' video-option--disabled' : ''}" id="ts-file-${slotId}">
        <span class="video-option__label">Arquivo</span>
        <div class="img-field-row">
          <video id="${previewId}" class="img-field-thumb"
                 src="${esc(hasFile ? currentVal : '')}"
                 style="${hasFile ? '' : 'display:none'}" muted></video>
          <div class="asset-btns">
            <label class="upload-label">
              <span class="upload-label-text">${btnText}</span>
              <input type="file" accept="video/mp4,video/*" ${hasEmbed ? 'disabled' : ''}
                     onchange="uploadTrailerFileSlot(this,'${dataAttr}',${idx},${slotIdx})">
            </label>
            <span class="field-note" style="margin-left:0">máximo 100 MB</span>
            ${hasFile ? `
            <a class="btn btn-small asset-btn-dl" href="${esc(currentVal)}" download target="_blank">↓ baixar</a>
            <button class="btn btn-danger btn-small" onclick="removeTrailerFileSlot('${dataAttr}',${idx},${slotIdx})">✕ remover</button>` : ''}
          </div>
        </div>
      </div>
      <p class="img-size-hint" style="margin-bottom:0.25rem">arquivo: recomendado 1920 × 1080 px · proporção 16:9 · máx. 100 MB · formatos MP4/MOV</p>
      <div style="text-align:right;margin-top:0.25rem">
        <button class="btn btn-danger btn-small" onclick="removeTrailerSlot('${dataAttr}',${idx},${slotIdx})">✕ remover trailer</button>
      </div>
    </div>`;
}

function setTrailerExclusive(slotId, active) {
  const urlOpt  = document.getElementById('ts-url-'  + slotId);
  const fileOpt = document.getElementById('ts-file-' + slotId);
  const urlInp  = urlOpt  ? urlOpt.querySelector('input[type="text"]')  : null;
  const fileInp = fileOpt ? fileOpt.querySelector('input[type="file"]') : null;
  if (active === 'url') {
    urlOpt?.classList.remove('video-option--disabled');
    fileOpt?.classList.add('video-option--disabled');
    if (fileInp) fileInp.disabled = true;
    if (urlInp)  urlInp.disabled  = false;
  } else if (active === 'file') {
    fileOpt?.classList.remove('video-option--disabled');
    urlOpt?.classList.add('video-option--disabled');
    if (urlInp)  urlInp.disabled  = true;
    if (fileInp) fileInp.disabled = false;
  } else {
    urlOpt?.classList.remove('video-option--disabled');
    fileOpt?.classList.remove('video-option--disabled');
    if (urlInp)  urlInp.disabled  = false;
    if (fileInp) fileInp.disabled = false;
  }
}

function syncTrailerUrl(input, dataAttr, idx, slotIdx) {
  const source = getTrailerSource(dataAttr);
  if (!Array.isArray(source[idx].videoTrailers)) source[idx].videoTrailers = [];
  const val = input.value.trim();
  source[idx].videoTrailers[slotIdx] = val;
  setTrailerExclusive(`trailer-${dataAttr}-${idx}-${slotIdx}`, val ? 'url' : null);
}

function addTrailerSlot(dataAttr, idx) {
  const source = getTrailerSource(dataAttr);
  if (!Array.isArray(source[idx].videoTrailers)) source[idx].videoTrailers = [];
  source[idx].videoTrailers.push('');
  const list = document.getElementById(`trailers-list-${dataAttr}-${idx}`);
  if (list) list.innerHTML = source[idx].videoTrailers.map((u, s) => renderTrailerSlot(dataAttr, idx, s, u)).join('');
}

async function removeTrailerSlot(dataAttr, idx, slotIdx) {
  const source  = getTrailerSource(dataAttr);
  const url     = source[idx].videoTrailers[slotIdx];
  const rawBase = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
  if (url && url.startsWith(rawBase) && !isEmbedUrl(url)) {
    if (!confirm('Remover este trailer e o arquivo do GitHub?')) return;
    const path = url.replace(rawBase, '').split('?')[0];
    try { const f = await ghGet(path); await ghDelete(path, f.sha, `assets: remove ${path}`); } catch {}
  }
  source[idx].videoTrailers.splice(slotIdx, 1);
  const list = document.getElementById(`trailers-list-${dataAttr}-${idx}`);
  if (list) list.innerHTML = source[idx].videoTrailers.length
    ? source[idx].videoTrailers.map((u, s) => renderTrailerSlot(dataAttr, idx, s, u)).join('')
    : '<p class="makingoff-empty">nenhum trailer ainda</p>';
}

async function uploadTrailerFileSlot(fileInput, dataAttr, idx, slotIdx) {
  const file = fileInput.files[0];
  if (!file) return;

  const label = fileInput.closest('label');
  const span  = label.querySelector('.upload-label-text');
  span.textContent = '…';
  label.style.pointerEvents = 'none';

  const source = getTrailerSource(dataAttr);
  if (!Array.isArray(source[idx].videoTrailers)) source[idx].videoTrailers = [];

  const ext      = file.name.split('.').pop().toLowerCase();
  const nameEl   = document.querySelector(`[data-${dataAttr}="${idx}"][data-key="title"]`)
                || document.querySelector(`[data-${dataAttr}="${idx}"][data-key="name"]`);
  const baseName = (nameEl && nameEl.value.trim())
    ? nameEl.value.trim().replace(/\s+/g, '_').replace(/[/\\?#%*:|"<>]/g, '').slice(0, 80)
    : Math.floor(Math.random() * 1e6).toString();
  const suffix   = slotIdx > 0 ? `_${slotIdx}` : '';
  const newPath  = `assets/filmes/trailers/${baseName}${suffix}_t.${ext}`;
  const rawBase  = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;

  // Remove arquivo anterior se for arquivo (não URL embed)
  const oldUrl = source[idx].videoTrailers[slotIdx];
  if (oldUrl && oldUrl.startsWith(rawBase) && !isEmbedUrl(oldUrl)) {
    const oldPath = oldUrl.replace(rawBase, '').split('?')[0];
    try { const f = await ghGet(oldPath); await ghDelete(oldPath, f.sha, `assets: remove ${oldPath}`); } catch {}
  }

  try {
    const base64 = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res(e.target.result.split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
    await ghPutBinary(newPath, base64, `assets: upload ${newPath}`);
    source[idx].videoTrailers[slotIdx] = `${rawBase}${newPath}`;
    // Re-render para atualizar botões download/remover
    const list = document.getElementById(`trailers-list-${dataAttr}-${idx}`);
    if (list) list.innerHTML = source[idx].videoTrailers.map((u, s) => renderTrailerSlot(dataAttr, idx, s, u)).join('');
    toast('Trailer enviado!', 'ok');
  } catch (err) {
    toast(`Erro no upload: ${err.message}`, 'err');
    span.textContent = '↑ enviar arquivo';
    label.style.pointerEvents = '';
  }
  fileInput.value = '';
}

async function removeTrailerFileSlot(dataAttr, idx, slotIdx) {
  if (!confirm('Remover este arquivo do GitHub?')) return;
  const source  = getTrailerSource(dataAttr);
  const url     = source[idx].videoTrailers[slotIdx];
  const rawBase = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
  if (url && url.startsWith(rawBase)) {
    const path = url.replace(rawBase, '').split('?')[0];
    try { const f = await ghGet(path); await ghDelete(path, f.sha, `assets: remove ${path}`); } catch {}
  }
  source[idx].videoTrailers[slotIdx] = '';
  const list = document.getElementById(`trailers-list-${dataAttr}-${idx}`);
  if (list) list.innerHTML = source[idx].videoTrailers.map((u, s) => renderTrailerSlot(dataAttr, idx, s, u)).join('');
  toast('Arquivo removido.', 'ok');
}

/* ── FOTOGRAFIAS — galeria de múltiplas imagens ── */
function fotografiasField(dataAttr, idx, currentImages) {
  const images = Array.isArray(currentImages) ? currentImages : [];
  return `
    <div class="field full">
      <label>Fotografias (imagem / still)</label>
      <div class="makingoff-gallery" id="fotografias-gallery-${dataAttr}-${idx}">
        ${renderFotografiasItems(dataAttr, idx, images)}
      </div>
      <label class="upload-label" style="margin-top:10px">
        <span class="upload-label-text">↑ adicionar imagem(s)</span>
        <input type="file" accept="image/*" multiple onchange="uploadFotografias(this,'${dataAttr}',${idx})">
      </label>
      <p class="img-size-hint">recomendado 1600 × 1200 px · proporção 4:3 · exibidas em galeria na página do filme</p>
    </div>`;
}

function renderFotografiasItems(dataAttr, idx, images) {
  if (!images.length) return '<p class="makingoff-empty">nenhuma imagem ainda</p>';
  return images.map((url, imgIdx) => `
    <div class="makingoff-item">
      <img src="${esc(url)}" class="makingoff-thumb" onerror="this.style.display='none'">
      <div class="asset-btns">
        <a class="btn btn-small asset-btn-dl" href="${esc(url)}" download target="_blank">↓ baixar</a>
        <button class="btn btn-danger btn-small" onclick="removeFotografia('${dataAttr}',${idx},${imgIdx})">✕</button>
      </div>
    </div>`).join('');
}

async function uploadFotografias(fileInput, dataAttr, idx) {
  const files = Array.from(fileInput.files);
  if (!files.length) return;

  const label = fileInput.closest('label');
  const span  = label.querySelector('.upload-label-text');
  label.style.pointerEvents = 'none';

  const source = dataAttr === 'film' ? data.films : dataAttr === 'other' ? data.otherProductions : data.upcomingFilms;
  if (!Array.isArray(source[idx].fotografias)) source[idx].fotografias = [];

  const rawBase = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
  const nameEl  = document.querySelector(`[data-${dataAttr}="${idx}"][data-key="title"]`)
               || document.querySelector(`[data-${dataAttr}="${idx}"][data-key="name"]`);
  const baseName = (nameEl && nameEl.value.trim())
    ? nameEl.value.trim().replace(/\s+/g, '_').replace(/[/\\?#%*:|"<>]/g, '').slice(0, 60)
    : 'fotografias';

  for (let n = 0; n < files.length; n++) {
    const file = files[n];
    span.textContent = `… (${n + 1}/${files.length})`;
    const ext     = file.name.split('.').pop().toLowerCase();
    const newPath = `assets/filmes/fotografias/${baseName}/${baseName}_foto_${Date.now()}_${n}.${ext}`;
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = e => res(e.target.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      await ghPutBinary(newPath, base64, `assets: upload ${newPath}`);
      source[idx].fotografias.push(`${rawBase}${newPath}`);
    } catch (err) {
      toast(`Erro no upload (${file.name}): ${err.message}`, 'err');
    }
  }

  const gallery = document.getElementById(`fotografias-gallery-${dataAttr}-${idx}`);
  if (gallery) gallery.innerHTML = renderFotografiasItems(dataAttr, idx, source[idx].fotografias);
  span.textContent = '↑ adicionar imagem(s)';
  label.style.pointerEvents = '';
  fileInput.value = '';
  toast('Imagens enviadas!', 'ok');
}

async function removeFotografia(dataAttr, idx, imgIdx) {
  if (!confirm('Remover esta fotografia do GitHub?')) return;
  const source = dataAttr === 'film' ? data.films : dataAttr === 'other' ? data.otherProductions : data.upcomingFilms;
  const url    = source[idx].fotografias[imgIdx];
  const rawBase = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
  if (url && url.startsWith(rawBase)) {
    const path = url.replace(rawBase, '').split('?')[0];
    try {
      const file = await ghGet(path);
      await ghDelete(path, file.sha, `assets: remove ${path}`);
    } catch { /* arquivo já não existe */ }
  }
  source[idx].fotografias.splice(imgIdx, 1);
  const gallery = document.getElementById(`fotografias-gallery-${dataAttr}-${idx}`);
  if (gallery) gallery.innerHTML = renderFotografiasItems(dataAttr, idx, source[idx].fotografias);
  toast('Fotografia removida.', 'ok');
}

/* ── MAKING OFF — galeria de múltiplas imagens ── */
function makingOffField(dataAttr, idx, currentImages) {
  const images = Array.isArray(currentImages) ? currentImages : [];
  return `
    <div class="field full">
      <label>Making off (imagens)</label>
      <div class="makingoff-gallery" id="makingoff-gallery-${dataAttr}-${idx}">
        ${renderMakingOffItems(dataAttr, idx, images)}
      </div>
      <label class="upload-label" style="margin-top:10px">
        <span class="upload-label-text">↑ adicionar imagem(s)</span>
        <input type="file" accept="image/*" multiple onchange="uploadMakingOffImages(this,'${dataAttr}',${idx})">
      </label>
      <p class="img-size-hint">recomendado 1600 × 1200 px · proporção 4:3 · exibidas em galeria na página do filme</p>
    </div>`;
}

function renderMakingOffItems(dataAttr, idx, images) {
  if (!images.length) return '<p class="makingoff-empty">nenhuma imagem ainda</p>';
  return images.map((url, imgIdx) => `
    <div class="makingoff-item">
      <img src="${esc(url)}" class="makingoff-thumb" onerror="this.style.display='none'">
      <div class="asset-btns">
        <a class="btn btn-small asset-btn-dl" href="${esc(url)}" download target="_blank">↓ baixar</a>
        <button class="btn btn-danger btn-small" onclick="removeMakingOffImage('${dataAttr}',${idx},${imgIdx})">✕</button>
      </div>
    </div>`).join('');
}

async function uploadMakingOffImages(fileInput, dataAttr, idx) {
  const files = Array.from(fileInput.files);
  if (!files.length) return;

  const label = fileInput.closest('label');
  const span  = label.querySelector('.upload-label-text');
  label.style.pointerEvents = 'none';

  const source = dataAttr === 'film' ? data.films : dataAttr === 'other' ? data.otherProductions : data.upcomingFilms;
  if (!Array.isArray(source[idx].makingOff)) source[idx].makingOff = [];

  const rawBase = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
  const nameEl  = document.querySelector(`[data-${dataAttr}="${idx}"][data-key="title"]`)
               || document.querySelector(`[data-${dataAttr}="${idx}"][data-key="name"]`);
  const baseName = (nameEl && nameEl.value.trim())
    ? nameEl.value.trim().replace(/\s+/g, '_').replace(/[/\\?#%*:|"<>]/g, '').slice(0, 60)
    : 'makingoff';

  for (let n = 0; n < files.length; n++) {
    const file = files[n];
    span.textContent = `… (${n + 1}/${files.length})`;
    const ext     = file.name.split('.').pop().toLowerCase();
    const newPath = `assets/filmes/makingoff/${baseName}/${baseName}_mo_${Date.now()}_${n}.${ext}`;
    try {
      const base64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload  = e => res(e.target.result.split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(file);
      });
      await ghPutBinary(newPath, base64, `assets: upload ${newPath}`);
      source[idx].makingOff.push(`${rawBase}${newPath}`);
    } catch (err) {
      toast(`Erro no upload (${file.name}): ${err.message}`, 'err');
    }
  }

  const gallery = document.getElementById(`makingoff-gallery-${dataAttr}-${idx}`);
  if (gallery) gallery.innerHTML = renderMakingOffItems(dataAttr, idx, source[idx].makingOff);
  span.textContent = '↑ adicionar imagem(s)';
  label.style.pointerEvents = '';
  fileInput.value = '';
  toast('Imagens enviadas!', 'ok');
}

async function removeMakingOffImage(dataAttr, idx, imgIdx) {
  if (!confirm('Remover esta imagem do GitHub?')) return;
  const source = dataAttr === 'film' ? data.films : dataAttr === 'other' ? data.otherProductions : data.upcomingFilms;
  const url    = source[idx].makingOff[imgIdx];
  const rawBase = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
  if (url && url.startsWith(rawBase)) {
    const path = url.replace(rawBase, '').split('?')[0];
    try {
      const file = await ghGet(path);
      await ghDelete(path, file.sha, `assets: remove ${path}`);
    } catch { /* arquivo já não existe */ }
  }
  source[idx].makingOff.splice(imgIdx, 1);
  const gallery = document.getElementById(`makingoff-gallery-${dataAttr}-${idx}`);
  if (gallery) gallery.innerHTML = renderMakingOffItems(dataAttr, idx, source[idx].makingOff);
  toast('Imagem removida.', 'ok');
}

async function removeAsset(fieldId, previewId) {
  if (!confirm('Remover este arquivo do GitHub?')) return;
  const field = document.getElementById(fieldId);
  const url   = field.value;
  if (!url) return;
  const rawBase = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
  if (url.startsWith(rawBase)) {
    const path = url.replace(rawBase, '').split('?')[0];
    try {
      const file = await ghGet(path);
      await ghDelete(path, file.sha, `assets: remove ${path}`);
    } catch { /* arquivo já não existe */ }
  }
  field.value = '';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  const thumb = document.getElementById(previewId);
  if (thumb) { thumb.src = ''; thumb.style.display = 'none'; }
  toast('Arquivo removido.', 'ok');
}

async function uploadImage(fileInput, targetFieldId, previewId) {
  const file = fileInput.files[0];
  if (!file) return;

  const label = fileInput.closest('label');
  const span  = label.querySelector('.upload-label-text');
  span.textContent = '…';
  label.style.pointerEvents = 'none';

  // Nome baseado no título/nome do item; espaços → "_"; sem nome → número aleatório
  const ext       = file.name.split('.').pop().toLowerCase();
  const parts     = targetFieldId.replace(/^img-/, '').split('-'); // ['film','0','imgPortrait']
  const dataAttr  = parts[0];
  const idx       = parts[1];
  const nameEl    = document.querySelector(`[data-${dataAttr}="${idx}"][data-key="title"]`)
                 || document.querySelector(`[data-${dataAttr}="${idx}"][data-key="name"]`);
  const titleRaw  = nameEl ? nameEl.value.trim() : '';
  const baseName  = dataAttr === 'sitedata' ? 'logo_site'
    : titleRaw
      ? titleRaw.replace(/\s+/g, '_').replace(/[/\\?#%*:|"<>]/g, '').slice(0, 80)
      : Math.floor(Math.random() * 1e6).toString();
  const isPreview   = targetFieldId.includes('videoHover');
  const isTrailer   = targetFieldId.includes('videoTrailer');
  const isLandscape = targetFieldId.includes('imgLandscape');
  const keySuffix   = isLandscape ? '_l' : '_p';
  const isFilmLike  = dataAttr === 'film' || dataAttr === 'other';
  const folder      = dataAttr === 'sitedata' ? 'assets/logo'
                    : dataAttr === 'team'     ? 'assets/equipe'
                    : dataAttr === 'parceiro' ? 'assets/parceiros'
                    : dataAttr === 'festival' ? 'assets/festivais'
                    : isPreview               ? 'assets/filmes/previews'
                    : isTrailer               ? 'assets/filmes/trailers'
                    : isLandscape && isFilmLike ? 'assets/filmes/paisagens'
                    : isFilmLike              ? 'assets/filmes/retratos'
                    : 'assets/filmes';
  const newPath   = `${folder}/${baseName}${keySuffix}.${ext}`;

  // Deleta arquivo anterior do mesmo slot (mesmo que tenha extensão diferente)
  const field      = document.getElementById(targetFieldId);
  const currentUrl = field.value;
  const rawBase    = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
  if (currentUrl && currentUrl.startsWith(rawBase)) {
    const oldPath = currentUrl.replace(rawBase, '').split('?')[0];
    try {
      const oldFile = await ghGet(oldPath);
      await ghDelete(oldPath, oldFile.sha, `assets: remove ${oldPath}`);
    } catch { /* arquivo anterior não encontrado — segue */ }
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    const base64 = e.target.result.split(',')[1];
    try {
      await ghPutBinary(newPath, base64, `assets: upload ${newPath}`);
      const url   = `${rawBase}${newPath}`;
      field.value = url;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      const thumb = document.getElementById(previewId);
      if (thumb) {
        thumb.src = url;
        if (thumb.tagName === 'VIDEO') thumb.load();
        thumb.style.display = 'block';
      }
      span.textContent = '↑ substituir';
      toast('Imagem enviada!', 'ok');
    } catch (err) {
      toast('Erro no upload: ' + err.message, 'err');
    } finally {
      label.style.pointerEvents = '';
      fileInput.value = '';
    }
  };
  reader.readAsDataURL(file);
}

/* ══════════════════════════════════════════════════════════
   UTILS
══════════════════════════════════════════════════════════ */
function toggleCard(id) {
  const target = document.getElementById(id);
  const isOpen = target.classList.contains('open');
  document.querySelectorAll('.card.open').forEach(c => c.classList.remove('open'));
  if (!isOpen) target.classList.add('open');
}

function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/"/g,'&quot;')
    .replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function setStatus(msg, type) {
  const el = document.getElementById('saveStatus');
  el.textContent = msg;
  el.className = 'save-status ' + (type||'');
}

function toast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show ' + (type||'');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.className = '', 3500);
}