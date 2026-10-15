// Importação de vendas no app: usa a mesma API e o mesmo fluxo do admin
// (validação na hora → aprovação do administrador → processamento).
// Quem pode usar: quem enxerga o menu "Importar Vendas" (segmentação dos Menus Dinâmicos).
(() => {
  const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const comp = (c) => { const [y, m] = c.split('-'); return `${MES[+m - 1]}/${y}`; };
  const num = (n) => (n ?? 0).toLocaleString('pt-BR');
  const when = (d) => new Date(String(d).includes('T') ? d : `${String(d).replace(' ', 'T')}Z`).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const $ = (id) => document.getElementById(id);

  // status do lote → [rótulo, classe visual, ícone]
  const STATUS = {
    received: ['Recebido', 'warn', 'hourglass-half'],
    validating: ['Validando', 'warn', 'hourglass-half'],
    with_errors: ['Com inconsistências', 'warn', 'exclamation'],
    awaiting_confirmation: ['Aguardando aprovação', 'warn', 'hourglass-half'],
    queued: ['Aprovado · na fila', 'ok', 'hourglass-half'],
    processing: ['Processando', 'ok', 'gear'],
    done: ['Processado', 'ok', 'check'],
    failed: ['Falhou', 'fail', 'xmark'],
    replaced: ['Substituído', 'fail', 'rotate'],
    returned: ['Devolvido para correção', 'fail', 'rotate-left'],
  };
  const TABS = {
    import: { title: 'Últimas importações', status: '' },
    validation: { title: 'Em validação', status: 'received,validating,with_errors,awaiting_confirmation,queued,processing,returned' },
    done: { title: 'Processados', status: 'done,failed,replaced' },
  };

  let api, download, toast, user;
  let file = null;
  let tab = 'import';
  let poll;

  function init(me) {
    ({ api, download, toast } = window.incentiva);
    user = me.user;
    $('dist').textContent = user.distributorName ?? 'Sem distribuidora vinculada';
    // períodos: do mês atual para trás, 12 meses
    const now = new Date();
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
    $('month').innerHTML = months.map((m) => `<option value="${m}">${comp(m)}</option>`).join('');
    if (!user.distributorId) {
      $('importView').innerHTML = '<div class="sv-empty"><i class="fa-solid fa-building-circle-xmark"></i>Seu usuário não está vinculado a uma distribuidora. Fale com o administrador.</div>';
    }
    loadList();
  }

  // ---------------------------------------------------------------- arquivo
  const MAX = 10 * 1024 * 1024;
  function pick(f) {
    if (!f) return;
    if (!/\.(xlsx|xls|csv)$/i.test(f.name)) return toast('Formatos aceitos: .xlsx, .xls ou .csv');
    if (f.size > MAX) return toast('Arquivo maior que 10 MB');
    file = f;
    $('dropT').textContent = f.name;
    $('dropS').textContent = `${(f.size / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} KB · pronto para enviar`;
    $('pick').hidden = true;
    $('sendBar').hidden = false;
  }
  function clearFile() {
    file = null;
    $('file').value = '';
    $('dropT').textContent = 'Arraste o arquivo aqui';
    $('dropS').textContent = 'ou toque para selecionar';
    $('pick').hidden = false;
    $('sendBar').hidden = true;
  }

  async function send() {
    if (!file) return;
    const btn = $('send');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>Validando...';
    const form = new FormData();
    form.append('file', file);
    form.append('distributorId', user.distributorId);
    form.append('competence', $('month').value);
    try {
      const batch = await api('/imports', { method: 'POST', body: form });
      clearFile();
      showBatch(batch);
      loadList();
    } catch (e) {
      toast(e.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>Enviar para validação';
    }
  }

  // ---------------------------------------------------------------- resultado de um lote
  function message(b) {
    switch (b.status) {
      case 'awaiting_confirmation':
        return ['ok', 'circle-check', 'Planilha validada sem erros', 'Agora ela aguarda a aprovação do administrador. Depois de aprovada, as vendas viram pontos.'];
      case 'with_errors':
        return ['warn', 'triangle-exclamation', 'Encontramos inconsistências', 'Corrija as linhas abaixo e envie de novo. Se preferir, o administrador pode aprovar só as linhas válidas.'];
      case 'queued':
      case 'processing':
        return ['ok', 'gear', 'Aprovado pelo administrador', 'As vendas estão sendo processadas e os pontos lançados...'];
      case 'done':
        return ['ok', 'circle-check', 'Lote processado', `${num(b.newCount ?? b.valid)} venda(s) importada(s) · ${num(b.creditedPoints)} pontos lançados.`];
      case 'failed':
        return ['fail', 'circle-xmark', 'Não foi possível processar', b.error || 'Confira o arquivo e envie de novo.'];
      case 'returned':
        return ['fail', 'rotate-left', `Devolvido por ${b.returnedByName ?? 'administrador'}`, `${b.returnReason ?? ''} — Corrija a planilha e envie de novo.`];
      case 'replaced':
        return ['fail', 'rotate', 'Lote substituído', 'Um envio mais novo da mesma competência ficou no lugar deste.'];
      default:
        return ['warn', 'hourglass-half', 'Validando', 'Aguarde um instante...'];
    }
  }

  function showBatch(b) {
    clearTimeout(poll);
    const [tone, icon, title, text] = message(b);
    $('result').innerHTML = `
      <article class="card imp-result ${tone}">
        <div class="imp-rh">
          <i class="fa-solid fa-${icon}"></i>
          <div><b>${title}</b><small>${esc(text)}</small></div>
          <button class="modal-x" aria-label="Fechar resultado" data-close><i class="fa-solid fa-xmark"></i></button>
        </div>
        <p class="imp-meta">Lote #${b.id} · ${esc(b.fileName)} · ${comp(b.competence)} · enviado em ${when(b.createdAt)}</p>
        <div class="imp-stats">
          <div><small>Registros</small><b>${num(b.total)}</b></div>
          <div><small>Válidos</small><b class="green">${num(b.valid)}</b></div>
          <div><small>Inválidos</small><b class="${b.invalid ? 'red' : ''}">${num(b.invalid)}</b></div>
          <div><small>Duplicados</small><b>${num(b.duplicates)}</b></div>
          <div><small>Correções</small><b>${num(b.corrections)}</b></div>
          <div><small>Pontos previstos</small><b>${num(b.predictedPoints)}</b></div>
        </div>
        ${b.errorsByType?.length ? `
          <h3>Inconsistências</h3>
          <ul class="imp-errs">${b.errorsByType.map((e) => `<li><b>${esc(e.label)}</b><span class="imp-n">${num(e.count)}</span><small>${esc(e.hint)}</small></li>`).join('')}</ul>
          <button class="btn-ghost" data-errors="${b.id}"><i class="fa-solid fa-download"></i>Baixar linhas com erro (CSV)</button>` : ''}
      </article>`;
    $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    // enquanto o admin não decide / o worker processa, acompanha o status
    if (['received', 'validating', 'awaiting_confirmation', 'queued', 'processing'].includes(b.status))
      poll = setTimeout(async () => {
        try {
          const fresh = await api(`/imports/${b.id}`);
          if (fresh.status !== b.status) loadList();
          if ($('result').querySelector('.imp-result')) showBatch(fresh);
        } catch { /* tenta de novo no próximo ciclo */ }
      }, 5000);
  }

  // ---------------------------------------------------------------- lista
  async function loadList() {
    const t = TABS[tab];
    $('listTitle').innerHTML = `<i class="fa-regular fa-clock"></i>${t.title}`;
    $('rows').innerHTML = '<div class="sv-empty"><i class="fa-solid fa-spinner fa-spin"></i>Carregando...</div>';
    try {
      const page = await api(`/imports?per_page=10${t.status ? `&status=${t.status}` : ''}`);
      $('rows').innerHTML = page.data.length
        ? page.data.map((b) => {
          const [label, tone, icon] = STATUS[b.status] ?? [b.status, 'warn', 'circle'];
          return `<button class="irow" data-id="${b.id}">
            <span class="ico ${tone === 'ok' ? 'i-green' : tone === 'fail' ? 'i-red' : 'i-gold'}"><i class="fa-solid fa-${icon}"></i></span>
            <span class="who"><b>${comp(b.competence)}</b><small>Enviado em ${when(b.createdAt)} · ${esc(b.fileName)}</small></span>
            <span class="st st-${tone}">${label}</span>
            <span class="num">${num(b.total)}<small>registros</small></span>
            <span class="num ${b.invalid ? 'red' : ''}">${num(b.invalid)}<small>erros</small></span>
            <span class="num">${num(b.valid)}<small>válidos</small></span>
            <span class="kebab"><i class="fa-solid fa-chevron-right"></i></span>
          </button>`;
        }).join('')
        : `<div class="sv-empty"><i class="fa-solid fa-inbox"></i>${tab === 'import' ? 'Você ainda não enviou nenhuma planilha.' : 'Nenhum lote aqui.'}</div>`;
    } catch (e) {
      $('rows').innerHTML = `<div class="sv-empty"><i class="fa-solid fa-triangle-exclamation"></i>${esc(e.message)}</div>`;
    }
  }

  // ---------------------------------------------------------------- eventos
  const drop = $('drop');
  $('file').addEventListener('change', (e) => pick(e.target.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); pick(e.dataTransfer.files[0]); });
  $('clear').addEventListener('click', clearFile);
  $('send').addEventListener('click', send);
  $('tpl').addEventListener('click', (e) => { e.preventDefault(); download('/imports/template', 'modelo-importacao-vendas.xlsx').catch((err) => toast(err.message)); });
  $('howto').addEventListener('click', (e) => { e.preventDefault(); $('howtoDlg').showModal(); });
  document.querySelectorAll('[data-sample]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    const kind = a.dataset.sample;
    download(`/imports/sample?distributorId=${user.distributorId}&competence=${$('month').value}&kind=${kind}`, `exemplo-${kind}-${$('month').value}.xlsx`)
      .then(() => toast('Planilha de exemplo baixada. Agora é só enviar.'))
      .catch((err) => toast(err.message));
  }));
  $('goHist').addEventListener('click', () => $('list').scrollIntoView({ behavior: 'smooth' }));
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]');
    if (!b) return;
    tab = b.dataset.t;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $('importView').hidden = tab !== 'import';
    loadList();
  });
  $('rows').addEventListener('click', async (e) => {
    const r = e.target.closest('[data-id]');
    if (!r) return;
    if (tab !== 'import') $('tabs').querySelector('[data-t="import"]').click();
    try { showBatch(await api(`/imports/${r.dataset.id}`)); } catch (err) { toast(err.message); }
  });
  $('result').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) { clearTimeout(poll); $('result').innerHTML = ''; }
    const err = e.target.closest('[data-errors]');
    if (err) download(`/imports/${err.dataset.errors}/errors.csv`, `erros-lote-${err.dataset.errors}.csv`).catch((x) => toast(x.message));
  });

  document.addEventListener('incentiva:returned', async (e) => {
    try { showBatch(await api(`/imports/${e.detail.id}`)); } catch { /* lista já mostra o status */ }
    $('drop').scrollIntoView({ behavior: 'smooth' });
  });
  if (window.incentiva) init({ user: window.incentiva.user });
  else document.addEventListener('incentiva:ready', (e) => init(e.detail), { once: true });
})();
