// Sessão do app: login na API do admin, checagem de perfil por página e menu
// montado em Configurações → Menus Dinâmicos para os perfis do usuário logado.
(() => {
  const API = window.INCENTIVA_API || 'http://localhost:3333/api';
  const KEY = 'incentiva-app-session';
  const LABEL = { super_admin: 'Super Admin', admin: 'Admin', manager: 'Gerente', seller: 'Vendedor', focal: 'Ponto Focal' };

  const store = {
    get() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* sem storage: sessão só desta página */ } },
    clear() { try { localStorage.removeItem(KEY); } catch { /* ok */ } },
  };
  const page = location.pathname.split('/').pop() || 'index.html';
  // telas internas herdam o acesso (e o destaque no menu) da tela de origem
  const access = { 'curso.html': 'treinamentos.html' }[page] ?? page;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // destino cadastrado no admin → página do app
  const PAGES = {
    '/inicio': 'inicio.html', '/gerente': 'gerente.html', '/equipe': 'equipe.html', '/extrato': 'extrato.html',
    '/treinamentos': 'treinamentos.html', '/ranking': 'ranking.html', '/importar': 'importar.html', '/vendas': 'vendas.html', '/metas': 'metas.html',
    '/extrato/historico': 'historico.html', '/quiz': 'quiz.html',
  };
  // Acesso por página segue os Menus Dinâmicos: a tela só abre se houver um item
  // visível no menu do usuário apontando para ela (a tela inicial do perfil sempre abre).
  // Conveniência de tela: a API das telas confere a mesma regra e responde 403.
  const menuPages = (items) => {
    const out = [];
    const walk = (list) => list.forEach((i) => { const p = PAGES[i.target]; if (p && !out.includes(p)) out.push(p); walk(i.children); });
    walk(items);
    return out;
  };
  // tela inicial: a do perfil, se estiver no menu; senão a primeira tela do menu; null = nenhuma tela liberada
  /** baixa um arquivo da API (modelo, planilha de exemplo, erros) com o token da sessão */
  async function download(path, filename) {
    const res = await api(path, { raw: true });
    const name = /filename="?([^";]+)/.exec(res.headers.get('content-disposition') || '')?.[1] || filename;
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    URL.revokeObjectURL(url);
  }

  const homeOf = (me) => {
    const pages = menuPages(me.items);
    return pages.includes(PAGES[me.home]) ? PAGES[me.home] : pages[0] ?? null;
  };

  async function api(path, opts = {}) {
    const s = store.get();
    const isForm = opts.body instanceof FormData;
    const res = await fetch(API + path, {
      ...opts,
      headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...(s?.token ? { Authorization: `Bearer ${s.token}` } : {}) },
    });
    if (opts.raw && res.ok) return res;
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(Array.isArray(body?.message) ? body.message.join(', ') : body?.message || `Erro ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }


  function toast(text) {
    const t = document.createElement('div');
    t.className = 'menu-toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  }

  // ---------------------------------------------------------------- login (index.html)
  function setupLogin() {
    const form = document.querySelector('.login-form');
    if (!form) return;
    const s = store.get();
    if (s?.token && s.home) return location.replace(s.home);

    // computador: só o formulário encolhe para caber na altura da janela; o texto da esquerda fica grande.
    // O card mira uma largura visual de até 540px (90% de 600): com zoom z, a largura em CSS é largura/z.
    // ponytail: poucas iterações bastam porque a altura cresce devagar com a largura (só a foto escala)
    const card = form;
    const fit = () => {
      card.style.removeProperty('zoom');
      card.style.removeProperty('width');
      if (innerWidth < 1024) return;
      card.style.width = '100%';
      const target = Math.min(card.offsetWidth, 600) * 0.9;
      const avail = innerHeight * 0.94;
      let z = 1;
      for (let i = 0; i < 4; i++) {
        card.style.zoom = '1';
        card.style.width = `${target / z}px`;
        z = Math.min(1, avail / card.scrollHeight);
      }
      card.style.zoom = String(z);
    };
    fit();
    addEventListener('load', fit);
    addEventListener('resize', fit);

    const email = form.querySelector('#email');
    const pw = form.querySelector('#pw');
    const btn = form.querySelector('button.btn');
    const error = document.createElement('p');
    error.className = 'login-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    btn.before(error);

    // etapa 2 (MFA): o backend só entrega o token depois do código do app autenticador
    const mfa = document.createElement('div');
    mfa.className = 'mfa-step';
    form.append(mfa);
    let challenge = null;

    async function finish(token) {
      store.set({ token });
      const me = await api('/app/me');
      const home = homeOf(me);
      if (!home) {
        api('/auth/logout', { method: 'POST' }).catch(() => null);
        throw new Error('Nenhuma tela do app está liberada para o seu perfil. Fale com o administrador.');
      }
      store.set({ token, home });
      location.href = home;
    }

    function showMfa(r) {
      challenge = r.challenge;
      form.classList.add('mfa-mode');
      mfa.innerHTML = `
        <h2><i class="fa-solid fa-shield-halved"></i>Verificação em duas etapas</h2>
        ${r.mfa === 'setup' ? `
          <p>Primeiro acesso com MFA: escaneie o QR code com o <b>Google Authenticator</b> (ou outro app autenticador) e digite o código gerado.</p>
          <img class="mfa-qr" src="${r.qr}" alt="QR code para cadastrar no app autenticador">
          <p class="mfa-secret">Sem câmera? Digite a chave no app: <code>${esc(r.secret)}</code></p>`
        : '<p>Abra o seu app autenticador e digite o código de 6 dígitos da conta Incentiva+.</p>'}
        <label for="mfaCode">Código de verificação</label>
        <div class="field"><i class="fa-solid fa-key"></i><input id="mfaCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000"></div>
        <button class="btn" type="submit" id="mfaBtn">Verificar e entrar <i class="fa-solid fa-arrow-right"></i></button>
        <button class="mfa-back" type="button">Voltar e usar outro usuário</button>`;
      mfa.querySelector('.mfa-back').onclick = () => { challenge = null; form.classList.remove('mfa-mode'); mfa.innerHTML = ''; error.hidden = true; btn.before(error); fit(); };
      const input = mfa.querySelector('#mfaCode');
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 6); if (input.value.length === 6) form.requestSubmit(); });
      mfa.prepend(error);
      fit();
      input.focus();
    }

    async function run(button, fn) {
      error.hidden = true;
      button.disabled = true;
      const label = button.innerHTML;
      button.innerHTML = 'Verificando... <i class="fa-solid fa-spinner fa-spin"></i>';
      try {
        await fn();
      } catch (err) {
        if (!challenge) store.clear();
        error.textContent = err instanceof TypeError ? 'Não foi possível falar com o servidor. Verifique se o backend está rodando.' : err.message;
        error.hidden = false;
        // desafio expirado ou tentativas esgotadas: volta para e-mail e senha
        if (challenge && err.status === 401) { challenge = null; form.classList.remove('mfa-mode'); mfa.innerHTML = ''; btn.before(error); }
      } finally {
        button.disabled = false;
        button.innerHTML = label;
      }
    }

    function login(e, p) {
      return run(btn, async () => {
        const r = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: e.trim(), password: p }) });
        if (r.mfa) showMfa(r);
        else await finish(r.token);
      });
    }

    function verify() {
      const code = mfa.querySelector('#mfaCode').value;
      if (!/^\d{6}$/.test(code)) { error.textContent = 'Digite os 6 dígitos do código.'; error.hidden = false; return; }
      return run(mfa.querySelector('#mfaBtn'), async () => {
        const r = await api('/auth/mfa', { method: 'POST', body: JSON.stringify({ challenge, code }) });
        await finish(r.token);
      });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (challenge) verify();
      else login(email.value, pw.value);
    });
  }

  // ---------------------------------------------------------------- menu
  const ICONS = {
    House: 'house', Home: 'house', TrendingUp: 'arrow-trend-up', ShoppingCart: 'cart-shopping', Target: 'bullseye',
    Trophy: 'trophy', Coins: 'coins', ReceiptText: 'file-lines', FileText: 'file-lines', History: 'clock-rotate-left',
    Newspaper: 'newspaper', GraduationCap: 'graduation-cap', Gamepad2: 'gamepad', CircleHelp: 'circle-question',
    Flag: 'flag', Medal: 'medal', Award: 'award', Users: 'users', UsersRound: 'users', User: 'user', CloudUpload: 'cloud-arrow-up',
    Upload: 'upload', Gift: 'gift', PieChart: 'chart-pie', ChartPie: 'chart-pie', BarChart3: 'chart-column', ChartColumn: 'chart-column',
    ChartBar: 'chart-bar', Layers: 'layer-group', ShoppingBag: 'bag-shopping', Calculator: 'calculator', Vote: 'check-to-slot', MapPin: 'location-dot',
    Star: 'star', Bell: 'bell', Settings: 'gear', Calendar: 'calendar', Megaphone: 'bullhorn', Video: 'video', BookOpen: 'book-open',
    Link: 'link', ExternalLink: 'arrow-up-right-from-square', Zap: 'bolt', Store: 'store', Wallet: 'wallet', Heart: 'heart',
    MessageSquare: 'comment', MessageCircle: 'comment', HelpCircle: 'circle-question', LayoutGrid: 'table-cells-large', Rocket: 'rocket',
  };
  const icon = (name) => `fa-solid fa-${ICONS[name] || 'circle'}`;
  const href = (item) => {
    if (/^https?:\/\//.test(item.target)) return { url: item.target, external: true };
    const p = PAGES[item.target];
    return p ? { url: p } : { url: '#', soon: true };
  };
  const isOn = (item) => href(item).url === access || item.children.some(isOn);
  function link(item, cls = '') {
    const h = href(item);
    const attrs = h.external ? ' target="_blank" rel="noopener"' : h.soon ? ' data-soon' : '';
    return `<a href="${esc(h.url)}"${attrs} class="${cls}${isOn(item) ? ' on' : ''}"><i class="${icon(item.icon)}"></i>${esc(item.title)}</a>`;
  }

  // grupo: submenu do próprio item. Celular: sobe acima da barra (fixed, a barra rola na
  // horizontal). Desktop: abre embaixo, na lateral.
  const mobile = () => matchMedia('(max-width:1023px)').matches;
  function group(item) {
    const on = isOn(item);
    return `<div class="nav-group${on && !mobile() ? ' open' : ''}">
      <a href="#" class="nav-parent${on ? ' on' : ''}" aria-expanded="${on && !mobile()}" aria-haspopup="true">
        <i class="${icon(item.icon)}"></i>${esc(item.title)}<span class="nav-caret fa-solid fa-chevron-down" aria-hidden="true"></span></a>
      <div class="nav-sub" role="menu">${item.children.map((c) => link(c)).join('')}</div>
    </div>`;
  }
  function closeAll(except) {
    document.querySelectorAll('.nav-group.open').forEach((g) => {
      if (g === except) return;
      g.classList.remove('open');
      g.querySelector('.nav-parent').setAttribute('aria-expanded', 'false');
    });
  }
  function toggle(g) {
    const open = !g.classList.contains('open');
    if (mobile()) closeAll(g);
    g.classList.toggle('open', open);
    g.querySelector('.nav-parent').setAttribute('aria-expanded', String(open));
    const sub = g.querySelector('.nav-sub');
    if (open && mobile()) {
      const r = g.getBoundingClientRect();
      sub.style.bottom = `${innerHeight - r.top + 8}px`;
      const w = sub.offsetWidth;
      sub.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    } else {
      sub.style.bottom = sub.style.left = '';
    }
  }

  function renderNav(items) {
    const nav = document.querySelector('nav.nav');
    if (!nav) return;
    const brand = nav.querySelector('.nav-brand')?.outerHTML ?? '';
    nav.innerHTML = brand + items.map((it) => (it.children.length ? group(it) : link(it))).join('') +
      '<a href="#" data-logout><i class="fa-solid fa-right-from-bracket"></i>Sair</a>';
    nav.querySelectorAll('.nav-parent').forEach((a) =>
      a.addEventListener('click', (e) => { e.preventDefault(); toggle(a.parentElement); }));
    nav.addEventListener('scroll', () => closeAll(), { passive: true });
    nav.dataset.source = 'admin';
  }

  // ---------------------------------------------------------------- usuário no cabeçalho
  function renderUser(user) {
    const role = user.profiles.map((p) => LABEL[p] || p).join(' + ');
    const initials = user.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    const me = document.querySelector('.topbar .me');
    if (me) {
      me.className = 'me who';
      me.setAttribute('aria-label', `${user.name} — sair`);
      me.dataset.logout = '';
      me.innerHTML = `<span class="ini">${esc(initials)}</span><span class="nm">${esc(user.name)}<small>${esc(role)}</small></span><i class="fa-solid fa-right-from-bracket" title="Sair"></i>`;
    }
    const hello = document.querySelector('.hello h1');
    if (hello) hello.textContent = `Olá, ${user.name.split(' ')[0]}!`;
    const sub = document.querySelector('.hello p');
    if (sub) sub.textContent = [role, user.distributorName].filter(Boolean).join(' | ');
  }

  // ---------------------------------------------------------------- tempo real (Socket.IO)
  // O admin devolveu um lote para correção: modal na hora, em qualquer tela.
  // Se a pessoa estava offline, o servidor reenvia ao conectar até ela fechar o aviso.
  function connectRealtime(token, canImport) {
    const origin = API.replace(/\/api\/?$/, '');
    const start = () => {
      const socket = window.io(origin, { auth: { token } });
      const queue = [];
      socket.on('import:returned', (b) => {
        if (queue.some((x) => x.id === b.id)) return;
        queue.push(b);
        if (queue.length === 1) show();
      });
      function show() {
        const b = queue[0];
        if (!b) return;
        const [y, m] = b.competence.split('-');
        const dlg = document.createElement('dialog');
        dlg.className = 'modal ret-dlg';
        dlg.setAttribute('aria-labelledby', 'retT');
        dlg.innerHTML = `
          <div class="modal-box">
            <header class="modal-h"><span class="modal-ic ret-ic"><i class="fa-solid fa-rotate-left"></i></span>
              <div><h2 id="retT">Planilha devolvida para correção</h2><p>Lote #${b.id} · ${esc(b.fileName)} · ${m}/${y}</p></div></header>
            <div class="modal-b">
              <p class="ret-by"><b>${esc(b.returnedByName)}</b> pediu uma correção${b.returnedAt ? ` em ${new Date(b.returnedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}` : ''}:</p>
              <blockquote class="ret-reason">${esc(b.reason)}</blockquote>
              <p class="ret-hint">Corrija a planilha e envie de novo para ${esc(b.distributorName)}. O novo envio substitui este lote.</p>
            </div>
            <footer class="modal-f">
              <button type="button" class="btn-ghost" data-ret="close">Fechar</button>
              ${canImport ? '<button type="button" class="btn" data-ret="fix"><i class="fa-solid fa-cloud-arrow-up"></i>Corrigir e reenviar</button>' : ''}
            </footer>
          </div>`;
        document.body.append(dlg);
        const done = (go) => {
          socket.emit('import:returned:seen', b.id);
          dlg.close();
          dlg.remove();
          queue.shift();
          if (go && page !== 'importar.html') return location.assign('importar.html');
          if (go) document.dispatchEvent(new CustomEvent('incentiva:returned', { detail: b }));
          show();
        };
        dlg.addEventListener('click', (e) => { const a = e.target.closest('[data-ret]'); if (a) done(a.dataset.ret === 'fix'); });
        dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
        dlg.showModal();
      }
    };
    if (window.io) return start();
    // o próprio servidor Socket.IO entrega o client
    const tag = Object.assign(document.createElement('script'), { src: `${origin}/socket.io/socket.io.min.js`, onload: start });
    document.head.append(tag);
  }

  // ---------------------------------------------------------------- páginas internas
  async function setupPage() {
    const s = store.get();
    if (!s?.token) return location.replace('index.html');
    document.documentElement.classList.add('auth-pending');
    let me;
    try {
      me = await api('/app/me');
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        store.clear();
        return location.replace('index.html');
      }
      // servidor fora do ar: deixa a página com o menu fixo do HTML
      document.documentElement.classList.remove('auth-pending');
      toast('Servidor indisponível: mostrando o menu padrão.');
      return;
    }
    const home = homeOf(me);
    const blocked = !menuPages(me.items).includes(access);
    if (blocked) {
      if (home) {
        sessionStorage.setItem('incentiva-denied', 'Seu perfil não tem acesso a esta tela.');
        return location.replace(home);
      }
      // menu sem nenhuma tela: não mostra o conteúdo, só o aviso
      document.querySelector('.app').innerHTML =
        '<div class="sv-empty" style="min-height:70vh;justify-content:center"><i class="fa-solid fa-lock"></i><b>Nenhuma tela liberada para o seu perfil</b>Fale com o administrador da campanha.<a href="#" data-logout class="btn" style="margin-top:12px">Sair</a></div>';
    }
    store.set({ token: s.token, home });
    connectRealtime(s.token, menuPages(me.items).includes('importar.html'));
    renderNav(me.items);
    renderUser(me.user);
    // páginas com dados da API esperam este evento (usuário já validado)
    if (!blocked) {
      window.incentiva = { api, download, toast, user: me.user };
      document.dispatchEvent(new CustomEvent('incentiva:ready', { detail: me }));
    }
    document.documentElement.classList.remove('auth-pending');
    const denied = sessionStorage.getItem('incentiva-denied');
    if (denied) {
      sessionStorage.removeItem('incentiva-denied');
      toast(denied);
    }
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-logout]')) {
      e.preventDefault();
      api('/auth/logout', { method: 'POST' }).catch(() => null);
      store.clear();
      location.href = 'index.html';
      return;
    }
    const soon = e.target.closest('a[data-soon]');
    if (soon) {
      e.preventDefault();
      toast(`“${soon.textContent.trim()}” ainda não tem tela no app de demonstração.`);
      return;
    }
    if (mobile() && !e.target.closest('.nav-group')) closeAll();
  });
  addEventListener('resize', () => mobile() && closeAll());

  if (document.querySelector('.login-form')) setupLogin();
  else setupPage();
})();
