// Mi Rumbo · Hábitos
// Datos: habitos.json en el mismo repo privado que datos.json (no se toca datos.json).
// Todo acceso a datos pasa por un "adaptador" { load(), save() }: hoy GitHub (y memoria
// para el modo demo); para cambiar de base de datos basta con escribir otro adaptador.
(() => {
  'use strict';
  const FILE = 'habitos.json', CFG_KEY = 'mirumbo.cfg', CACHE_KEY = 'mirumbo.habitos.cache', REFRESH_MS = 60000;
  const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  const DIAS_LARGO = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const DIAS_INI = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
  const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'set', 'oct', 'nov', 'dic'];
  const ORDEN_SEMANA = [1, 2, 3, 4, 5, 6, 0]; // la semana empieza el lunes
  const COLORES = [
    ['#1E8E50', 'Verde'], ['#2F5BD3', 'Azul'], ['#7A4BD0', 'Violeta'], ['#C93C86', 'Rosa'],
    ['#D0412F', 'Rojo'], ['#C8611A', 'Naranja'], ['#A87E00', 'Ámbar'], ['#138A8A', 'Turquesa']
  ];
  const DEMO = new URLSearchParams(location.search).has('demo');

  const $ = id => document.getElementById(id);
  const clone = o => JSON.parse(JSON.stringify(o));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const readLS = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ---------- Fechas (cadenas 'AAAA-MM-DD' en hora local) ----------
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const parse = s => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10), 12);
  const hoy = () => iso(new Date());
  const addDays = (s, k) => { const d = parse(s); d.setDate(d.getDate() + k); return iso(d); };
  const dow = s => parse(s).getDay();
  const fechaCorta = s => { const d = parse(s); return DIAS[d.getDay()] + ' ' + d.getDate() + ' ' + MES[d.getMonth()]; };
  const fechaLarga = s => fechaCorta(s) + ' ' + s.slice(0, 4);

  // ---------- Modelo ----------
  const emptyData = () => ({ version: 1, habitos: [], marcas: {} });
  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    const out = { version: 1, habitos: Array.isArray(d.habitos) ? d.habitos : [], marcas: d.marcas && typeof d.marcas === 'object' ? d.marcas : {} };
    out.habitos.forEach(h => {
      if (!h.frecuencia || !['diaria', 'dias'].includes(h.frecuencia.tipo)) h.frecuencia = { tipo: 'diaria', dias: [] };
      if (!Array.isArray(h.frecuencia.dias)) h.frecuencia.dias = [];
      if (!Array.isArray(h.pausas)) h.pausas = [];
      if (!h.creado) h.creado = hoy();
    });
    return out;
  }
  const pausedOn = (h, s) => h.pausas.some(p => s >= p.desde && (!p.hasta || s < p.hasta));
  const isPaused = h => pausedOn(h, hoy());
  const scheduled = (h, s) => s >= h.creado && !pausedOn(h, s) && (h.frecuencia.tipo === 'diaria' || h.frecuencia.dias.includes(dow(s)));
  const freqText = f => {
    if (f.tipo === 'diaria' || f.dias.length === 7) return 'Todos los días';
    const ds = ORDEN_SEMANA.filter(d => f.dias.includes(d));
    if (ds.join() === '1,2,3,4,5') return 'De lunes a viernes';
    if (ds.join() === '6,0') return 'Fines de semana';
    return ds.map(d => DIAS[d]).join(' · ');
  };

  function dayStat(data, s) {
    const marks = data.marcas[s] || [];
    let n = 0, k = 0;
    for (const h of data.habitos) if (scheduled(h, s)) { n++; if (marks.includes(h.id)) k++; }
    return { n, k };
  }
  function stats(data, year) {
    const today = hoy(), res = { actual: 0, larga: 0, completosAnio: 0, mesK: 0, mesN: 0 };
    if (!data.habitos.length) return res;
    const start = data.habitos.reduce((m, h) => h.creado < m ? h.creado : m, today);
    let run = 0;
    for (let s = start; s <= today; s = addDays(s, 1)) {
      const { n, k } = dayStat(data, s);
      if (n === 0) continue; // un día sin hábitos programados no corta la racha
      if (k === n) { run++; if (run > res.larga) res.larga = run; if (s.slice(0, 4) === String(year)) res.completosAnio++; }
      else if (s !== today) run = 0; // hoy aún está en curso
    }
    // Racha actual: hacia atrás desde hoy (hoy cuenta solo si ya está completo)
    for (let s = today, first = true; s >= start; s = addDays(s, -1), first = false) {
      const { n, k } = dayStat(data, s);
      if (n === 0) continue;
      if (k === n) res.actual++;
      else if (!first) break;
    }
    for (let i = 1; i <= 30; i++) { const { n, k } = dayStat(data, addDays(today, -i)); res.mesK += k; res.mesN += n; }
    return res;
  }

  // ---------- Adaptadores de datos ----------
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str); let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const b64decode = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

  function GitHubAdapter(c) {
    const url = 'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + '/contents/' + FILE;
    async function req(method, body) {
      const headers = { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
      if (body) headers['Content-Type'] = 'application/json';
      try { return await fetch(url, { method, headers, cache: 'no-store', body: body ? JSON.stringify(body) : undefined }); }
      catch (_) { throw new Error('Sin conexión a internet.'); }
    }
    async function fail(res) {
      let m = ''; try { m = (await res.json()).message || ''; } catch (_) {}
      if (res.status === 401) return new Error('Token inválido o vencido. Vuelve a conectar desde Finanzas.');
      if (res.status === 403) return new Error(/rate limit/i.test(m) ? 'GitHub pidió esperar un momento (límite de uso).' : 'El token no tiene permiso de escritura (Contents: Read and write).');
      return new Error('GitHub respondió ' + res.status + (m ? ': ' + m : '') + '.');
    }
    return {
      async load() {
        const res = await req('GET');
        if (res.status === 404) return { data: null, rev: null }; // aún no existe: se crea al guardar
        if (!res.ok) throw await fail(res);
        const j = await res.json();
        try { return { data: normalize(JSON.parse(b64decode(j.content))), rev: j.sha }; }
        catch (_) { throw new Error('habitos.json no es un JSON válido. Revísalo en GitHub.'); }
      },
      async save(data, rev, message) {
        const res = await req('PUT', { message, content: b64encode(JSON.stringify(data, null, 1) + '\n'), sha: rev || undefined });
        if (res.ok) return (await res.json()).content.sha;
        if (res.status === 409 || res.status === 422) return null; // otro dispositivo guardó antes
        throw await fail(res);
      }
    };
  }

  function MemoryAdapter(seed) {
    let data = clone(seed), rev = 1;
    return {
      async load() { await new Promise(r => setTimeout(r, 250)); return { data: clone(data), rev: String(rev) }; },
      async save(next, r) { if (r !== String(rev)) return null; data = clone(next); rev++; return String(rev); }
    };
  }

  // Almacén: aplica cada cambio al instante en pantalla y lo sube agrupado.
  // Si otro dispositivo guardó antes, relee la última versión y vuelve a aplicar los cambios.
  function createStore(adapter, cacheKey, hooks) {
    let view = null, server = null, queue = [], timer = null, chain = Promise.resolve(), pending = 0;
    const saveCache = () => { if (cacheKey) try { localStorage.setItem(cacheKey, JSON.stringify(view)); } catch (_) {} };
    const settle = () => { view = clone(server.data); saveCache(); hooks.change(); };
    function flush() {
      clearTimeout(timer);
      const batch = queue.splice(0); if (!batch.length) return;
      const message = batch.length === 1 ? batch[0].msg : 'Hábitos: ' + batch.length + ' cambios';
      const run = chain.then(async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          if (!server || attempt > 0) { const p = await adapter.load(); server = p.data ? p : { data: emptyData(), rev: null }; }
          const next = clone(server.data); batch.forEach(b => b.op(next));
          const rev = await adapter.save(next, server.rev, message);
          if (rev) { server = { data: next, rev }; return; }
        }
        throw new Error('Otro dispositivo estaba guardando a la vez. Intenta de nuevo.');
      });
      chain = run.catch(() => {});
      run.then(() => { pending -= batch.length; if (!pending) { settle(); hooks.saved(); } },
        async err => {
          pending -= batch.length; hooks.error(err);
          try { const p = await adapter.load(); if (!pending) { server = p.data ? p : { data: emptyData(), rev: null }; settle(); } } catch (_) {}
        });
    }
    return {
      get data() { return view; },
      get pending() { return pending; },
      hydrate() { const c = cacheKey && readLS(cacheKey); if (c) { view = normalize(c); return true; } return false; },
      async refresh() {
        if (pending) return;
        const p = await adapter.load();
        if (pending) return;
        server = p.data ? p : { data: emptyData(), rev: null };
        settle();
      },
      apply(op, msg) {
        if (!view) view = emptyData();
        op(view); pending++; hooks.change(); hooks.saving();
        queue.push({ op, msg }); clearTimeout(timer); timer = setTimeout(flush, 500);
      },
      flush,
      forget() { if (cacheKey) localStorage.removeItem(cacheKey); }
    };
  }

  // ---------- Datos de ejemplo (solo ?demo=1) ----------
  function demoData() {
    let seed = 20261111; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const today = hoy(), d0 = addDays(today, -340);
    const habitos = [
      { id: 'demo-leer', nombre: 'Leer 20 minutos', color: COLORES[0][0], frecuencia: { tipo: 'diaria', dias: [] }, creado: d0, pausas: [] },
      { id: 'demo-ejer', nombre: 'Ejercicio', color: COLORES[5][0], frecuencia: { tipo: 'dias', dias: [1, 3, 5] }, creado: addDays(d0, 20), pausas: [] },
      { id: 'demo-ingl', nombre: 'Practicar inglés', color: COLORES[1][0], frecuencia: { tipo: 'dias', dias: [1, 2, 3, 4, 5] }, creado: addDays(d0, 45), pausas: [{ desde: addDays(today, -130), hasta: addDays(today, -110) }] },
      { id: 'demo-dorm', nombre: 'Dormir antes de las 12', color: COLORES[2][0], frecuencia: { tipo: 'diaria', dias: [] }, creado: addDays(d0, 90), pausas: [] },
      { id: 'demo-agua', nombre: 'Tomar 2 litros de agua', color: COLORES[7][0], frecuencia: { tipo: 'diaria', dias: [] }, creado: addDays(today, -60), pausas: [{ desde: addDays(today, -5), hasta: null }] }
    ];
    const data = { version: 1, habitos, marcas: {} };
    for (let s = d0; s < today; s = addDays(s, 1)) {
      const age = (parse(s) - parse(d0)) / (parse(today) - parse(d0)), recent = s >= addDays(today, -9);
      const ids = habitos.filter(h => scheduled(h, s) && (recent || rnd() < 0.45 + age * 0.45)).map(h => h.id);
      if (ids.length) data.marcas[s] = ids;
    }
    const t = habitos.filter(h => scheduled(h, today)).slice(0, 2).map(h => h.id);
    if (t.length) data.marcas[today] = t;
    return data;
  }

  // ---------- Estado de la vista ----------
  const S = { store: null, cfgSig: '', loading: false, day: hoy(), year: new Date().getFullYear(), focusDay: null, pendingDel: null, editing: null, started: false, active: false };
  const cfgNow = () => { const c = readLS(CFG_KEY); return c && c.owner && c.repo && c.token ? c : null; };
  let toastT;
  function toast(t) { const el = $('toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2800); }
  function setStatus(kind, txt) { $('hStatus').innerHTML = '<span class="dot ' + (kind || '') + '"></span><span>' + esc(txt) + '</span>'; }
  const hora = () => new Date().toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

  const hooks = {
    change: () => render(),
    saving: () => setStatus('', 'Guardando…'),
    saved: () => setStatus('live', DEMO ? 'Modo demo · no se guarda' : 'Sincronizado · ' + hora()),
    error: err => { setStatus('err', err.message); toast('No se guardó: ' + err.message); }
  };

  function connect() {
    if (DEMO) {
      if (!S.store) { S.store = createStore(MemoryAdapter(demoData()), null, hooks); S.cfgSig = 'demo'; }
      return true;
    }
    const c = cfgNow(), sig = c ? c.owner + '/' + c.repo + '/' + c.token : '';
    if (sig === S.cfgSig && S.store) return true;
    if (!c) { localStorage.removeItem(CACHE_KEY); S.store = null; S.cfgSig = ''; return false; } // sin token: no dejar hábitos en este dispositivo
    if (S.cfgSig && S.cfgSig !== sig) localStorage.removeItem(CACHE_KEY); // cambió de cuenta o repo
    S.cfgSig = sig;
    S.store = createStore(GitHubAdapter(c), CACHE_KEY, hooks);
    return true;
  }

  async function refresh(manual) {
    if (!S.store || S.store.pending) return;
    const btn = $('hSync'); btn.classList.add('spin');
    try {
      await S.store.refresh();
      hooks.saved();
      if (manual) toast('Hábitos actualizados');
    } catch (e) { setStatus('err', e.message); if (manual) toast(e.message); }
    finally { S.loading = false; btn.classList.remove('spin'); render(); }
  }

  function activate() {
    S.active = true;
    const ok = connect();
    if (ok && !S.started) {
      S.started = true;
      const had = S.store.hydrate();
      S.loading = !had;
      setStatus('', had ? 'Mostrando datos guardados · sincronizando…' : (DEMO ? 'Cargando demo…' : 'Cargando…'));
      render(); refresh();
    } else if (ok) { render(); refresh(); }
    else { S.started = false; render(); }
  }

  // ---------- Render ----------
  function render() {
    const conn = !!S.store, data = S.store && S.store.data;
    $('hDemo').hidden = !DEMO;
    $('hGate').hidden = conn;
    $('hSync').disabled = !conn;
    const empty = conn && !S.loading && data && !data.habitos.length;
    $('hEmpty').hidden = !empty;
    $('hApp').hidden = !conn || empty;
    $('hApp').setAttribute('aria-busy', S.loading ? 'true' : 'false');
    if (!conn) { setStatus('', 'Sin conectar'); renderHead(null); return; }
    renderHead(data);
    if (empty) return;
    const d = data || emptyData(); // mientras carga por primera vez
    renderToday(d); renderSummary(d); renderHeat(d); renderList(d);
  }

  function renderHead(data) {
    const today = hoy(), isToday = S.day === today;
    $('hDayLbl').textContent = isToday ? 'Hoy · ' + fechaCorta(S.day) : fechaLarga(S.day);
    $('hNext').disabled = S.day >= today;
    $('hToday').hidden = isToday;
    if (!data || S.loading) { $('hHero').textContent = '—'; $('hHeroSub').textContent = S.store ? 'Cargando tus hábitos…' : 'Conecta tus datos para empezar.'; return; }
    const { n, k } = dayStat(data, S.day);
    $('hHero').textContent = n ? k + '/' + n : '—';
    $('hHeroSub').textContent = !data.habitos.length ? 'Crea tu primer hábito para empezar.'
      : !n ? (isToday ? 'Hoy no te toca ningún hábito.' : 'Ese día no tocaba ningún hábito.')
      : k === n ? '¡Día completo! ' + (isToday ? 'Todo listo por hoy.' : 'Cumpliste todo.')
      : (n === 1 ? 'hábito' : 'hábitos') + ' completados · ' + Math.round(k / n * 100) + '%';
  }

  const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  function renderToday(data) {
    $('hTicketH').textContent = S.day === hoy() ? 'Ticket de hoy' : 'Ticket del ' + fechaCorta(S.day);
    const box = $('hChecks');
    if (S.loading) { box.innerHTML = '<li class="sk"></li><li class="sk"></li><li class="sk"></li>'; $('hOff').textContent = ''; return; }
    const marks = data.marcas[S.day] || [];
    const todo = data.habitos.filter(h => scheduled(h, S.day));
    box.innerHTML = todo.length ? todo.map(h => {
      const on = marks.includes(h.id);
      return '<li><label class="check' + (on ? ' on' : '') + '" style="--c:' + esc(h.color) + '"><input type="checkbox" data-mark="' + esc(h.id) + '"' + (on ? ' checked' : '') + '><span class="box">' + CHECK + '</span><span class="cname">' + esc(h.nombre) + '</span><span class="cfreq">' + esc(freqText(h.frecuencia)) + '</span></label></li>';
    }).join('') : '<li class="none">' + (S.day === hoy() ? 'Hoy no te toca ningún hábito. Descansa.' : 'Ese día no tocaba ningún hábito.') + '</li>';
    const off = data.habitos.filter(h => !scheduled(h, S.day) && S.day >= h.creado);
    $('hOff').textContent = off.length ? 'No toca ' + (S.day === hoy() ? 'hoy' : 'ese día') + ': ' + off.map(h => h.nombre + (pausedOn(h, S.day) ? ' (en pausa)' : '')).join(', ') + '.' : '';
  }

  function renderSummary(data) {
    const r = stats(data, S.year), dias = n => n + (n === 1 ? ' día' : ' días');
    $('sAct').textContent = S.loading ? '—' : dias(r.actual);
    $('sLarga').textContent = S.loading ? '—' : dias(r.larga);
    $('sAnioLbl').textContent = 'Días completos en ' + S.year;
    $('sAnio').textContent = S.loading ? '—' : String(r.completosAnio);
    $('sMes').textContent = S.loading ? '—' : (r.mesN ? Math.round(r.mesK / r.mesN * 100) + '%' : '—');
    $('sMesD').textContent = r.mesN ? r.mesK + ' de ' + r.mesN + ' hábitos programados' : 'Sin hábitos programados';
  }

  function years(data) {
    const now = new Date().getFullYear();
    const first = data.habitos.reduce((m, h) => Math.min(m, +h.creado.slice(0, 4)), now);
    const ys = []; for (let y = now; y >= first; y--) ys.push(y); return ys;
  }

  function cellLevel(n, k) { if (!n) return 'none'; const p = k / n; return p === 0 ? 0 : p < 0.34 ? 1 : p < 0.67 ? 2 : p < 1 ? 3 : 4; }
  function tipText(s, n, k) { return fechaLarga(s) + ' · ' + (n ? k + '/' + n + (n === 1 ? ' hábito' : ' hábitos') + ' · ' + Math.round(k / n * 100) + '%' : 'sin hábitos programados'); }

  function renderHeat(data) {
    const ys = years(data);
    if (!ys.includes(S.year)) S.year = ys[0];
    $('hYear').innerHTML = ys.map(y => '<option' + (y === S.year ? ' selected' : '') + '>' + y + '</option>').join('');
    $('hYPrev').disabled = S.year <= ys[ys.length - 1];
    $('hYNext').disabled = S.year >= ys[0];

    const today = hoy(), jan1 = S.year + '-01-01', dec31 = S.year + '-12-31';
    const start = addDays(jan1, -((dow(jan1) + 6) % 7)); // lunes de la primera semana
    const cols = Math.ceil(((parse(dec31) - parse(start)) / 864e5 + 1) / 7);
    const heat = $('hHeat'); heat.style.setProperty('--cols', cols);
    if (!S.focusDay || S.focusDay.slice(0, 4) !== String(S.year)) S.focusDay = S.year === new Date().getFullYear() ? today : dec31;
    let html = '<span class="hm-corner" aria-hidden="true"></span>';
    for (let c = 0; c < cols; c++) for (let r = 0; r < 7; r++) {
      const s = addDays(start, c * 7 + r);
      if (s.slice(8) === '01' && s.slice(0, 4) === String(S.year)) html += '<span class="hm-month" style="grid-column:' + (c + 2) + '" aria-hidden="true">' + MES[+s.slice(5, 7) - 1] + '</span>';
    }
    ['lun', '', 'mié', '', 'vie', '', 'dom'].forEach((t, r) => { html += '<span class="hm-wd" style="grid-row:' + (r + 2) + '" aria-hidden="true">' + t + '</span>'; });
    for (let c = 0; c < cols; c++) for (let r = 0; r < 7; r++) {
      const s = addDays(start, c * 7 + r), pos = 'grid-column:' + (c + 2) + ';grid-row:' + (r + 2);
      if (s < jan1 || s > dec31) { html += '<span class="hm-pad" style="' + pos + '"></span>'; continue; }
      if (s > today) { html += '<span class="hm-cell future" style="' + pos + '" aria-hidden="true"></span>'; continue; }
      const { n, k } = dayStat(data, s), lv = S.loading ? 'none' : cellLevel(n, k);
      html += '<button type="button" class="hm-cell l' + lv + (s === S.day ? ' sel' : '') + (s === today ? ' today' : '') + '" style="' + pos + '" data-day="' + s + '" tabindex="' + (s === S.focusDay ? 0 : -1) + '" aria-label="' + esc(tipText(s, n, k)) + '" aria-pressed="' + (s === S.day) + '"></button>';
    }
    heat.innerHTML = html;
    $('hHeatCap').textContent = 'Cada cuadro es un día de ' + S.year + '; el color muestra qué parte de tus hábitos programados cumpliste.';
    // En pantallas angostas, mostrar la semana actual (o el día elegido)
    const sc = heat.parentElement, tgt = heat.querySelector('.hm-cell.sel') || heat.querySelector('.hm-cell.today');
    if (sc.scrollWidth > sc.clientWidth && tgt && !sc.dataset.user) sc.scrollLeft = Math.max(0, tgt.offsetLeft - sc.clientWidth + 80);
  }

  function renderList(data) {
    const list = data.habitos.slice().sort((a, b) => isPaused(a) - isPaused(b) || a.nombre.localeCompare(b.nombre, 'es'));
    $('hCount').textContent = data.habitos.length + (data.habitos.length === 1 ? ' hábito' : ' hábitos');
    $('hList').innerHTML = list.map(h => {
      const p = isPaused(h);
      const del = S.pendingDel === h.id
        ? '<button type="button" class="btn sm danger" data-del="' + esc(h.id) + '">Confirmar eliminación</button><button type="button" class="btn sm ghost" data-undel>Cancelar</button>'
        : '<button type="button" class="btn sm ghost" data-del="' + esc(h.id) + '" aria-label="Eliminar ' + esc(h.nombre) + '">Eliminar</button>';
      return '<li class="hab' + (p ? ' paused' : '') + '" style="--c:' + esc(h.color) + '"><span class="hdot" aria-hidden="true"></span>' +
        '<div class="hinfo"><span class="hname">' + esc(h.nombre) + (p ? ' <span class="stamp">En pausa</span>' : '') + '</span><span class="hmeta">' + esc(freqText(h.frecuencia)) + ' · desde ' + esc(fechaLarga(h.creado)) + '</span></div>' +
        '<div class="hacts"><button type="button" class="btn sm" data-edit="' + esc(h.id) + '" aria-label="Editar ' + esc(h.nombre) + '">Editar</button>' +
        '<button type="button" class="btn sm" data-pause="' + esc(h.id) + '" aria-label="' + (p ? 'Reanudar ' : 'Pausar ') + esc(h.nombre) + '">' + (p ? 'Reanudar' : 'Pausar') + '</button>' + del + '</div></li>';
    }).join('');
  }

  // ---------- Acciones ----------
  const store = () => S.store;
  function setMark(id, on) {
    const day = S.day, h = store().data.habitos.find(x => x.id === id); if (!h) return;
    store().apply(d => {
      const a = (d.marcas[day] || []).filter(x => x !== id);
      if (on) a.push(id);
      if (a.length) d.marcas[day] = a; else delete d.marcas[day];
    }, (on ? 'Completar: ' : 'Desmarcar: ') + h.nombre + ' (' + day + ')');
    const st = dayStat(store().data, day);
    if (on && st.n && st.k === st.n) toast(day === hoy() ? '¡Día completo! Todo listo por hoy.' : 'Día completo');
  }
  function togglePause(id) {
    const h = store().data.habitos.find(x => x.id === id); if (!h) return;
    const today = hoy(), paused = isPaused(h);
    store().apply(d => {
      const x = d.habitos.find(y => y.id === id); if (!x) return;
      const open = x.pausas.find(p => !p.hasta || today < p.hasta);
      if (paused) { if (open) { if (open.desde >= today) x.pausas = x.pausas.filter(p => p !== open); else open.hasta = today; } }
      else if (!open) x.pausas.push({ desde: today, hasta: null });
    }, (paused ? 'Reanudar: ' : 'Pausar: ') + h.nombre);
    toast(paused ? h.nombre + ' reanudado' : h.nombre + ' en pausa: no cuenta desde hoy');
  }
  function remove(id) {
    const h = store().data.habitos.find(x => x.id === id); if (!h) return;
    S.pendingDel = null;
    store().apply(d => {
      d.habitos = d.habitos.filter(x => x.id !== id);
      Object.keys(d.marcas).forEach(k => { const a = d.marcas[k].filter(x => x !== id); if (a.length) d.marcas[k] = a; else delete d.marcas[k]; });
    }, 'Eliminar hábito: ' + h.nombre);
    toast('Hábito eliminado');
  }

  // ---------- Formulario (crear / editar) ----------
  const dlg = () => $('hDlg');
  function openForm(id) {
    const h = id ? store().data.habitos.find(x => x.id === id) : null;
    S.editing = h ? h.id : null;
    $('hDlgH').textContent = h ? 'Editar hábito' : 'Nuevo hábito';
    $('hfSave').textContent = h ? 'Guardar cambios' : 'Crear hábito';
    $('hfName').value = h ? h.nombre : '';
    const color = h ? h.color : COLORES[(store().data.habitos.length) % COLORES.length][0];
    document.querySelectorAll('input[name=hfColor]').forEach(r => { r.checked = r.value === color; });
    if (!document.querySelector('input[name=hfColor]:checked')) document.querySelector('input[name=hfColor]').checked = true;
    const f = h ? h.frecuencia : { tipo: 'diaria', dias: [] };
    $(f.tipo === 'dias' ? 'hfDias' : 'hfDiaria').checked = true;
    document.querySelectorAll('input[name=hfDia]').forEach(c => { c.checked = f.tipo === 'dias' ? f.dias.includes(+c.value) : [1, 2, 3, 4, 5].includes(+c.value); });
    $('hfStart').value = h ? h.creado : hoy(); $('hfStart').max = hoy();
    $('hfMsg').textContent = '';
    syncFreq();
    dlg().showModal();
    $('hfName').focus();
  }
  function syncFreq() { $('hfDaysBox').hidden = !$('hfDias').checked; }
  function submitForm(e) {
    e.preventDefault();
    const msg = $('hfMsg'), nombre = $('hfName').value.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!nombre) { msg.textContent = 'Escribe un nombre para el hábito.'; $('hfName').focus(); return; }
    const color = (document.querySelector('input[name=hfColor]:checked') || {}).value || COLORES[0][0];
    const tipo = $('hfDias').checked ? 'dias' : 'diaria';
    const dias = tipo === 'dias' ? [...document.querySelectorAll('input[name=hfDia]:checked')].map(c => +c.value) : [];
    if (tipo === 'dias' && !dias.length) { msg.textContent = 'Elige al menos un día de la semana.'; document.querySelector('input[name=hfDia]').focus(); return; }
    let creado = $('hfStart').value || hoy(); if (creado > hoy()) creado = hoy();
    const frecuencia = { tipo, dias: dias.sort() };
    if (S.editing) {
      const id = S.editing;
      store().apply(d => { const x = d.habitos.find(y => y.id === id); if (x) Object.assign(x, { nombre, color, frecuencia: clone(frecuencia), creado }); }, 'Editar hábito: ' + nombre);
      toast('Cambios guardados');
    } else {
      const h = { id: newId(), nombre, color, frecuencia, creado, pausas: [] };
      store().apply(d => { if (!d.habitos.some(x => x.id === h.id)) d.habitos.push(clone(h)); }, 'Nuevo hábito: ' + nombre);
      toast('Hábito creado');
    }
    dlg().close();
  }

  // ---------- Tooltip del mapa ----------
  function showTip(cell) {
    const tip = $('hTip'); if (!cell || !cell.dataset.day) { tip.hidden = true; return; }
    tip.textContent = cell.getAttribute('aria-label'); tip.hidden = false;
    const r = cell.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
    const above = r.top - h - 8 > 4;
    tip.style.left = x + 'px'; tip.style.top = (above ? r.top - h - 8 : r.bottom + 8) + 'px';
  }
  const hideTip = () => { $('hTip').hidden = true; };

  function selectDay(s, focus) {
    S.day = s; S.focusDay = s; render();
    const c = $('hHeat').querySelector('[data-day="' + s + '"]');
    if (c && focus) { c.focus(); showTip(c); }
  }

  // ---------- Eventos ----------
  function bind() {
    document.addEventListener('mirumbo:view', e => { if (e.detail === 'habitos') activate(); else { S.active = false; hideTip(); if (S.store) S.store.flush(); } });
    $('hPrev').onclick = () => { S.day = addDays(S.day, -1); S.year = +S.day.slice(0, 4); S.focusDay = S.day; render(); };
    $('hNext').onclick = () => { if (S.day < hoy()) { S.day = addDays(S.day, 1); S.year = +S.day.slice(0, 4); S.focusDay = S.day; render(); } };
    $('hToday').onclick = () => { S.day = hoy(); S.year = new Date().getFullYear(); S.focusDay = S.day; render(); };
    $('hSync').onclick = () => refresh(true);
    $('hConn').onclick = () => {
      location.hash = '#finanzas';
      requestAnimationFrame(() => { if ($('setup').hidden) $('gear').click(); else $('ghOwner').focus(); $('setup').scrollIntoView({ block: 'start' }); });
    };
    $('hGateBtn').onclick = $('hConn').onclick;
    $('hNew').onclick = () => openForm(null);
    $('hEmptyBtn').onclick = () => openForm(null);
    $('hChecks').addEventListener('change', e => { const c = e.target.closest('[data-mark]'); if (c) setMark(c.dataset.mark, c.checked); });
    $('hList').addEventListener('click', e => {
      const t = e.target.closest('button'); if (!t) return;
      if (t.dataset.edit) openForm(t.dataset.edit);
      else if (t.dataset.pause) togglePause(t.dataset.pause);
      else if (t.hasAttribute('data-undel')) { S.pendingDel = null; render(); }
      else if (t.dataset.del) {
        if (S.pendingDel === t.dataset.del) remove(t.dataset.del);
        else { S.pendingDel = t.dataset.del; render(); const b = $('hList').querySelector('[data-del="' + t.dataset.del + '"]'); if (b) b.focus(); }
      }
    });
    // Año
    const goYear = y => { S.year = y; S.focusDay = null; delete $('hHeat').parentElement.dataset.user; render(); };
    $('hYear').onchange = e => goYear(+e.target.value);
    $('hYPrev').onclick = () => goYear(S.year - 1);
    $('hYNext').onclick = () => goYear(S.year + 1);
    // Mapa: ratón, toque y teclado
    const heat = $('hHeat');
    heat.addEventListener('pointerover', e => { const c = e.target.closest('.hm-cell[data-day]'); if (c && e.pointerType === 'mouse') showTip(c); });
    heat.addEventListener('pointerleave', hideTip);
    heat.addEventListener('focusin', e => showTip(e.target.closest('.hm-cell[data-day]')));
    heat.addEventListener('focusout', hideTip);
    heat.addEventListener('click', e => { const c = e.target.closest('.hm-cell[data-day]'); if (c) selectDay(c.dataset.day, true); });
    heat.addEventListener('keydown', e => {
      const c = e.target.closest('.hm-cell[data-day]'); if (!c) return;
      const step = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }[e.key];
      let s = null;
      if (step) s = addDays(c.dataset.day, step);
      else if (e.key === 'Home') s = S.year + '-01-01';
      else if (e.key === 'End') s = [hoy(), S.year + '-12-31'].sort()[0];
      if (!s) return;
      e.preventDefault();
      const n = heat.querySelector('[data-day="' + s + '"]'); if (!n) return;
      c.tabIndex = -1; n.tabIndex = 0; S.focusDay = s; n.focus(); n.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    heat.parentElement.addEventListener('scroll', () => { heat.parentElement.dataset.user = '1'; hideTip(); }, { passive: true });
    addEventListener('scroll', hideTip, { passive: true });
    // Formulario
    $('hfForm').addEventListener('submit', submitForm);
    $('hfCancel').onclick = () => dlg().close();
    document.querySelectorAll('input[name=hfFreq]').forEach(r => { r.onchange = syncFreq; });
    dlg().addEventListener('click', e => { if (e.target === dlg()) dlg().close(); });
    // Sincronización periódica y al volver a la app
    setInterval(() => { if (S.active && !document.hidden) refresh(); }, REFRESH_MS);
    document.addEventListener('visibilitychange', () => { if (!S.store) return; if (document.hidden) S.store.flush(); else if (S.active) refresh(); });
    addEventListener('pagehide', () => { if (S.store) S.store.flush(); });
  }

  // Paleta del formulario
  $('hfColors').innerHTML = COLORES.map(([c, n], i) => '<input type="radio" name="hfColor" id="hfc' + i + '" value="' + c + '"><label for="hfc' + i + '" style="--c:' + c + '" title="' + n + '"><span class="sr">' + n + '</span></label>').join('');
  $('hfDaysList').innerHTML = ORDEN_SEMANA.map(d => '<input type="checkbox" name="hfDia" id="hfd' + d + '" value="' + d + '"><label for="hfd' + d + '"><span aria-hidden="true">' + DIAS_INI[d] + '</span><span class="sr">' + DIAS_LARGO[d] + '</span></label>').join('');

  bind();
  if (document.documentElement.dataset.view === 'habitos') activate(); else render();
})();
