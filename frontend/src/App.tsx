import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Login from './components/Login';
import CidadesSecao from './components/CidadesSecao';
import UsuariosSecao from './components/UsuariosSecao';
import PerfilSecao from './components/PerfilSecao';
import TemaSecao from './components/TemaSecao';
import LogoSecao from './components/LogoSecao';
import BackupSecao from './components/BackupSecao';
import ImportarSecao from './components/ImportarSecao';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts';
import './index.css';
import {
  api,
  API,
  FALLBACK_DASH,
  corStatus,
  STATUS_ROTULO,
  br,
  type Dashboard,
  type Me,
  type Notif,
  type PlanilhaRow,
} from './api';

type Tab = 'dashboard' | 'planilha' | 'relatorios' | 'graficos' | 'reservas';
type SecaoConfig = 'acesso' | 'cidades' | 'tema' | 'importar' | 'logo' | 'backup' | 'perfil';

// Toast arrastável: aparece em todo login/refresh; fechar só dispensa nesta
// sessão (não marca como lida — isso é feito na central). Arraste pelo título.
function ToastItem({ n, onView, onClose }: { n: Notif; onView: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; w: number } | null>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* sem captura: arrasto parcial */
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const g = grab.current;
    if (!g || !ref.current) return;
    setPos({ x: e.clientX - g.dx, y: e.clientY - g.dy, w: ref.current.offsetWidth });
  };
  const onUp = () => {
    grab.current = null;
  };
  return (
    <div
      ref={ref}
      className={`toast ${n.evento === 'vencimento' ? 'red' : ''}`}
      style={
        pos
          ? { position: 'fixed', left: pos.x, top: pos.y, width: pos.w, margin: 0, zIndex: 60 }
          : undefined
      }
    >
      <b
        style={{ cursor: 'move', touchAction: 'none', userSelect: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        aria-label="Arraste para mover"
      >
        ⠿ {n.titulo}
      </b>
      {n.corpo}
      <div className="actions">
        <button onClick={onView}>Ver campanha</button>
        <button onClick={onClose}>Fechar</button>
      </div>
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem('led_token') || '');
  const [perfil, setPerfil] = useState(() => localStorage.getItem('led_perfil') || '');
  const [logando, setLogando] = useState(false);
  const isAdmin = perfil === 'admin';
  const [login, setLogin] = useState('admin');
  const [senha, setSenha] = useState('admin123');
  const [loginErro, setLoginErro] = useState('');
  const [cidade, setCidade] = useState(
    () => new URLSearchParams(location.search).get('cidades') || '',
  );
  const [tab, setTab] = useState<Tab>('planilha');
  const [dash, setDash] = useState<Dashboard>(FALLBACK_DASH);
  const [online, setOnline] = useState(false);
  const [rows, setRows] = useState<PlanilhaRow[]>([]);
  const [q, setQ] = useState('');
  const [stFilter, setStFilter] = useState('');
  const [importMsg, setImportMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Seleção múltipla da planilha (exclusão em lote)
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const alternarSelecao = (id: string) =>
    setSelecionadas((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]));
  const excluirSelecionadas = async () => {
    if (!selecionadas.length) return;
    if (!confirm(`Excluir ${selecionadas.length} campanha(s)?`)) return;
    try {
      const r = await api.excluirLote(selecionadas);
      setSelecionadas([]);
      setImportMsg({
        tipo: r.ignoradas.length ? 'erro' : 'ok',
        texto: `Excluídas ${r.excluidas.length}.${r.ignoradas.length ? ` Ignoradas: ${r.ignoradas.map((x) => `${x.id} (${x.motivo})`).join(' · ')}` : ''}`,
      });
      carregar();
    } catch (e: any) {
      setImportMsg({ tipo: 'erro', texto: e.message });
    }
  };
  // Navegação: troca a aba e rola até o painel (senão parece que nada aconteceu)
  const painelRef = useRef<HTMLDivElement>(null);
  const irParaAba = (t: Tab, secao?: SecaoConfig) => {
    setTab(t);
    if (secao) setConfigSecao(secao);
    setTimeout(() => painelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };
  const [destaque, setDestaque] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(
    () => localStorage.getItem('led_onboarding') !== '1',
  );
  const [editInline, setEditInline] = useState<{
    id: string;
    campo: 'anunciante' | 'inicio' | 'fim';
    valor: string;
  } | null>(null);
  const extrairAnunciante = (n: Notif): string | null => {
    if (n.anunciante) return n.anunciante;
    const t = (n.corpo || '').replace(/^Reserva de /i, '');
    const m = t.match(/^(.*?)\s+(inicia em|encerra em|·)/);
    const nome = (m ? m[1] : t.split('·')[0]).trim();
    return nome || null;
  };
  const verCampanha = (n: Notif) => {
    if (online && me && !can('planilha')) {
      setTab('dashboard');
      return;
    }
    irParaAba('planilha');
    const nome = extrairAnunciante(n);
    if (nome) setQ(nome);
    setStFilter('');
    trocarCidade('');
    setDestaque(n.campanha_ref || null);
  };
  useEffect(() => {
    if (!destaque) return;
    const t = setTimeout(() => setDestaque(null), 5000);
    return () => clearTimeout(t);
  }, [destaque]);
  // dias de hoje (dash.hoje) até a data: >0 faltam, 0 encerra hoje, <0 encerrou
  const diasAte = (iso: string) =>
    Math.round(
      (new Date(iso + 'T12:00:00').getTime() - new Date(dash.hoje + 'T12:00:00').getTime()) /
        86400000,
    );
  const [sortK, setSortK] = useState('inicio');
  const [sortD, setSortD] = useState<1 | -1>(1);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [sino, setSino] = useState(false);
  const [ledSel, setLedSel] = useState<string | null>(null);
  const [modal, setModal] = useState(false);
  const [lat, setLat] = useState('0.6s');
  const [form, setForm] = useState({
    anunciante: '',
    led_codigo: 'AJU 01',
    cidade_id: 'aracaju',
    inicio: '2026-11-01',
    fim: '2026-12-01',
    reservada: false,
  });
  const [editCampId, setEditCampId] = useState<string | null>(null);
  // Menu de cadastro de LEDs (padrão visual do painel)
  const [cidades, setCidades] = useState<{ id: string; nome: string; uf: string }[]>([]);
  const [ledsLista, setLedsLista] = useState<any[]>([]);
  const [ledsMenu, setLedsMenu] = useState(false);
  // Controle de acesso: o que este usuário pode ver/fazer (vem de /api/me)
  const [me, setMe] = useState<Me | null>(null);
  const can = (recurso: string) => online && !!me?.efetivas?.includes(recurso);
  const temConfig = can('usuarios') || can('cidades') || can('config') || can('importar');
  // Menu de usuários (admin): CRUD + cidades + recursos por usuário
  const [usersLista, setUsersLista] = useState<any[]>([]);
  const [recursosLista, setRecursosLista] = useState<{ id: string; rotulo: string }[]>([]);
  // Múltiplas reservas por campanha (cada uma notifica o início próximo)
  const [resMenu, setResMenu] = useState<{
    campId: string;
    anunciante: string;
    led: string;
  } | null>(null);
  const [resLista, setResLista] = useState<any[]>([]);
  const [resForm, setResForm] = useState({
    anunciante: '',
    inicio: '2026-12-01',
    fim: '2026-12-31',
  });
  const [resMsg, setResMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  // Menu global de cadastro de reservas (padrão LEDs/Usuários)
  const [resListaG, setResListaG] = useState<any[]>([]);
  const [resCamps, setResCamps] = useState<any[]>([]);
  const [resFormG, setResFormG] = useState({
    campanha_id: '',
    led_codigo: '',
    anunciante: '',
    inicio: '2026-12-01',
    fim: '2026-12-31',
  });
  // Janela independente de edição de reserva (a criação fica no formulário)
  const [resEditM, setResEditM] = useState<{
    id: string;
    campLabel: string;
    anunciante: string;
    inicio: string;
    fim: string;
  } | null>(null);
  const [resMsgM, setResMsgM] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [resMsgG, setResMsgG] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [ledForm, setLedForm] = useState({
    codigo: '',
    endereco: '',
    cidade_id: 'aracaju',
    espacos: '',
  });
  const [ledEditando, setLedEditando] = useState<string | null>(null);
  const [ledMsg, setLedMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  // Tema (paleta configurável): lido da API e aplicado nas variáveis CSS
  const [tema, setTema] = useState<{
    vars: Record<string, string>;
    rotulos: Record<string, string>;
  }>({ vars: {}, rotulos: {} });
  // Logo da empresa (persistida no back; exibição fixa 38px no lugar do ícone)
  const [logo, setLogo] = useState<string | null>(null);
  const [logoPrev, setLogoPrev] = useState<string | null>(null);
  const [logoMsg, setLogoMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [temaMsg, setTemaMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [configSecao, setConfigSecao] = useState<SecaoConfig>('acesso');
  // Tela cheia de configurações (troca o painel; LEDs/Usuários/Cidades moram aqui)
  const [tela, setTela] = useState<'painel' | 'config'>('painel');
  // Menu de cadastro de cidades (id, nome, UF, fuso — padrão do banco)
  const [cidForm, setCidForm] = useState({ id: '', nome: '', uf: '', fuso: 'America/Maceio' });
  const [cidEditando, setCidEditando] = useState<string | null>(null);
  const [cidMsg, setCidMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const t0 = performance.now();
    try {
      const [d, p, n, cids, leds] = await Promise.all([
        api.dashboard(cidade),
        api.planilha(cidade).catch(() => [] as PlanilhaRow[]),
        api.notificacoes(cidade).catch(() => [] as Notif[]),
        api.cidades().catch(() => [] as { id: string; nome: string; uf: string }[]),
        api.leds(cidade).catch(() => [] as any[]),
      ]);
      const m = await api.me().catch(() => null);
      const t = await api.tema().catch(() => null);
      const lg = await api.logo().catch(() => null);
      setDash(d);
      setOnline(true);
      if (t) setTema(t);
      if (lg) setLogo(lg.logo);
      setRows(p);
      setNotifs(n.map((x) => ({ ...x, titulo: x.titulo, corpo: x.corpo })));
      if (m) setMe(m);
      if (cids.length) setCidades(cids);
      if (leds.length) setLedsLista(leds);
      setLat(`${((performance.now() - t0) / 1000).toFixed(1)}s`);
    } catch {
      setOnline(false);
    }
  }, [cidade]);
  // Aba Relatórios: dimensão + cidade/LED/cliente + status + período → PDF
  const [dismissed, setDismissed] = useState<(number | string)[]>([]);
  const [relDim, setRelDim] = useState<'led' | 'cidade' | 'cliente'>('led');
  const [relCidade, setRelCidade] = useState('');
  const [relLed, setRelLed] = useState('');
  const [relAnu, setRelAnu] = useState('');
  const [relStatus, setRelStatus] = useState<string[]>([
    'veiculando',
    'a_vencer',
    'agendada',
    'reservada',
    'vencida',
  ]);
  const [relDe, setRelDe] = useState('');
  const [relAte, setRelAte] = useState('');
  const [relMsg, setRelMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const relChave = (r: PlanilhaRow) =>
    relDim === 'led' ? `${r.led} — ${r.cidade}` : relDim === 'cidade' ? r.cidade : r.anunciante;
  const relFiltradas = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!relCidade ||
            r.cidade === (cidades.find((c) => c.id === relCidade)?.nome || relCidade)) &&
          (!relLed || r.led === relLed) &&
          (!relAnu || (r.anunciante || '').toLowerCase().includes(relAnu.toLowerCase())) &&
          (!relStatus.length || relStatus.includes(r.status)) &&
          (!relDe || r.fim >= relDe) &&
          (!relAte || r.inicio <= relAte),
      ),
    [rows, relCidade, relLed, relAnu, relStatus, relDe, relAte, cidades],
  );
  const relGrupos = useMemo(() => {
    const m = new Map<string, PlanilhaRow[]>();
    for (const r of relFiltradas) {
      const k = relChave(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(r);
    }
    return [...m.entries()].sort();
  }, [relFiltradas]); // eslint-disable-line react-hooks/exhaustive-deps
  const gerarPdf = async () => {
    setRelMsg(null);
    try {
      const token = localStorage.getItem('led_token');
      const resp = await fetch(`${API}/api/relatorios/pdf`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          dimensao: relDim,
          cidades: relCidade,
          status: relStatus,
          anunciante: relAnu,
          de: relDe,
          ate: relAte,
        }),
      });
      if (!resp.ok)
        throw new Error(
          ((await resp.json().catch(() => ({}))) as any).erro || `HTTP ${resp.status}`,
        );
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `relatorio-${relDim}.pdf`;
      a.click();
      URL.revokeObjectURL(a.href);
      setRelMsg({ tipo: 'ok', texto: `PDF gerado (${relFiltradas.length} campanhas).` });
    } catch (e: any) {
      setRelMsg({ tipo: 'erro', texto: e.message });
    }
  };
  // Tipo de gráfico da distribuição por status
  const [tipoDist, setTipoDist] = useState<'rosca' | 'pizza' | 'barras'>('rosca');
  useEffect(() => {
    carregar();
    const i = setInterval(carregar, 30000);
    return () => clearInterval(i);
  }, [carregar]);

  const podeEditar = can('campanhas_editar');

  // Gantt: um bloco por campanha COM NOME (veiculando, reservada e vencida) +
  // LIVRE completando — LED nunca parece vazio havendo campanhas

  // Opções do filtro de cidade: sempre da API (novas cidades aparecem sozinhas)
  const cidadesOpts = cidades.length
    ? cidades
    : [
        { id: 'aracaju', nome: 'Aracaju', uf: 'SE' },
        { id: 'salvador', nome: 'Salvador', uf: 'BA' },
      ];
  const cidadeNome = (id: string) => cidadesOpts.find((c) => c.id === id)?.nome || id || 'Todas';

  const trocarCidade = (v: string) => {
    setCidade(v);
    setSelecionadas([]);
    setDismissed([]);
    // LED selecionado fora da cidade sai da seleção
    if (ledSel) {
      const todos = [...ledsLista, ...dash.gantt_por_led];
      const led = todos.find((l: any) => l.codigo === ledSel);
      if (led && v && led.cidade_id !== v) setLedSel(null);
    }
    const u = new URL(location.href);
    if (!v) u.searchParams.delete('cidades');
    else u.searchParams.set('cidades', v);
    history.replaceState({}, '', u);
  };

  const linhas = useMemo(() => {
    let r = [...rows];
    if (q) {
      const s = q.toLowerCase();
      r = r.filter((x) => [x.cidade, x.led, x.anunciante].join(' ').toLowerCase().includes(s));
    }
    if (stFilter) r = r.filter((x) => x.status === stFilter);
    r.sort((a, b) => String((a as any)[sortK]).localeCompare(String((b as any)[sortK])) * sortD);
    return r;
  }, [rows, q, stFilter, sortK, sortD]);
  const [viewportWidth, setViewportWidth] = useState(typeof window !== 'undefined' ? window.innerWidth : 1024);
  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = viewportWidth < 600;
  const isTablet = viewportWidth >= 600 && viewportWidth < 980;

  const ganttBlocos = (camps: any[]) => {
    const clsPorStatus: Record<string, string> = {
      veiculando: 'veic',
      a_vencer: 'veic',
      agendada: 'res',
      reservada: 'res',
      vencida: 'venc',
    };
    const rotuloStatus: Record<string, string> = {
      agendada: 'RESERVADA',
      reservada: 'RESERVADA',
      vencida: 'ENCERRADA',
    };
    const blocos: { cls: string; label: string; w: number; title?: string; showLabel: boolean }[] = camps.map(
      (c: any) => {
        const cls = clsPorStatus[c.status] || 'veic';
        const pre = rotuloStatus[c.status] ? `${rotuloStatus[c.status]} · ` : '';
        return {
          cls,
          label: `${pre}${String(c.anunciante).toUpperCase()}`,
          w: 0,
          title: `${c.anunciante} · ${br(c.inicio)} → ${br(c.fim)} · ${STATUS_ROTULO[c.status] || c.status}`,
          showLabel: !isMobile,
        };
      },
    );
    if (!blocos.length) return [{ cls: 'livre', label: 'LIVRE', w: 96, showLabel: !isMobile }];
    const w = Math.min(40, Math.max(10, Math.floor(88 / blocos.length)));
    blocos.forEach((b) => {
      b.w = w;
    });
    const usado = w * blocos.length;
    if (usado < 90) blocos.push({ cls: 'livre', label: 'LIVRE', w: 96 - usado, showLabel: !isMobile });
    return blocos;
  };

  const sair = () => {
    localStorage.removeItem('led_token');
    localStorage.removeItem('led_perfil');
    setToken('');
    setPerfil('');
  };

  const salvarInline = async (
    row: PlanilhaRow,
    campo: 'anunciante' | 'inicio' | 'fim',
    valor: string,
  ) => {
    try {
      if (row.id) await api.editarCampanha(row.id, { [campo]: valor });
      else {
        const camp = await api
          .campanhas()
          .then((cs) =>
            cs.find((c: any) => c.anunciante === row.anunciante && c.led_codigo === row.led),
          );
        if (!camp) return;
        await api.editarCampanha(camp.id, { [campo]: valor });
      }
      carregar();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const iniciarEditInline = (row: PlanilhaRow, campo: 'anunciante' | 'inicio' | 'fim') => {
    setEditInline({ id: row.id!, campo, valor: row[campo] || '' });
  };
  const cancelarEditInline = () => setEditInline(null);
  const salvarEditInline = async () => {
    if (!editInline) return;
    try {
      await api.editarCampanha(editInline.id, { [editInline.campo]: editInline.valor });
      setEditInline(null);
      carregar();
    } catch (e: any) {
      alert(e.message);
    }
  };

  // Aplica a paleta nas variáveis CSS (painel, fontes, gráficos via corStatus)
  useEffect(() => {
    const root = document.documentElement;
    for (const [k, v] of Object.entries(tema.vars || {})) root.style.setProperty(`--${k}`, v);
  }, [tema]);

  // Aba padrão respeita a visibilidade do usuário (só com permissões carregadas)
  // Aba padrão respeita a visibilidade do usuário (só com permissões carregadas)
  useEffect(() => {
    if (!me || !online) return;
    if (tab === 'planilha' && !can('planilha')) {
      setTimeout(() => setTab('dashboard'), 0);
    } else if (tab === 'graficos' && !can('graficos')) {
      setTimeout(() => setTab('dashboard'), 0);
    } else if (tab === 'relatorios' && !can('relatorios')) {
      setTimeout(() => setTab('dashboard'), 0);
    } else if (tab === 'reservas' && !can('reservas')) {
      setTimeout(() => setTab('dashboard'), 0);
    }
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  const criarCampanha = async () => {
    try {
      if (editCampId) {
        await api.editarCampanha(editCampId, { ...form, reservada: form.reservada ? 1 : 0 });
      } else {
        await api.criarCampanha({
          ...form,
          id: 'c' + Date.now(),
          cidade_id: form.cidade_id || cidade || 'aracaju',
          reservada: form.reservada ? 1 : 0,
        });
      }
      setModal(false);
      setEditCampId(null);
      carregar();
    } catch (e: any) {
      alert(e.message);
    }
  };
  const abrirNovaCampanha = (led?: string) => {
    setEditCampId(null);
    setForm({
      anunciante: '',
      led_codigo: led || 'AJU 01',
      cidade_id: cidade || 'aracaju',
      inicio: '2026-11-01',
      fim: '2026-12-01',
      reservada: false,
    });
    setModal(true);
  };
  // Atalhos de teclado: Ctrl+N nova campanha, Ctrl+S salvar, Escape cancelar/fechar
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'n' && podeEditar) {
        e.preventDefault();
        abrirNovaCampanha();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && editInline) {
        e.preventDefault();
        salvarEditInline();
      }
      if (e.key === 'Escape') {
        if (editInline) setEditInline(null);
        if (modal) setModal(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [podeEditar, editInline, modal]);
  const abrirEditarCampanha = async (row: PlanilhaRow) => {
    let id: string | undefined = row.id;
    if (!id) {
      const camp = await api
        .campanhas()
        .then((cs) =>
          cs.find((c: any) => c.anunciante === row.anunciante && c.led_codigo === row.led),
        )
        .catch(() => null);
      if (!camp) return;
      id = camp.id;
    }
    if (!id) return;
    const camp = await api
      .campanhas()
      .then((cs) => cs.find((c: any) => c.id === id))
      .catch(() => null);
    setEditCampId(id);
    setForm({
      anunciante: row.anunciante,
      led_codigo: row.led,
      cidade_id: camp?.cidade_id || cidade || 'aracaju',
      inicio: row.inicio,
      fim: row.fim,
      reservada: camp?.reservada ? true : row.status === 'agendada' || row.status === 'reservada',
    });
    setModal(true);
  };
  const excluirCampanha = async (row: PlanilhaRow) => {
    let id: string | undefined = row.id;
    if (!id) {
      const camp = await api
        .campanhas()
        .then((cs) =>
          cs.find((c: any) => c.anunciante === row.anunciante && c.led_codigo === row.led),
        )
        .catch(() => null);
      if (!camp) return;
      id = camp.id;
    }
    if (!id) return;
    if (!confirm(`Excluir a campanha "${row.anunciante}" (${row.led})?`)) return;
    try {
      await api.excluirCampanha(id);
      carregar();
    } catch (e: any) {
      alert(e.message);
    }
  };
  // Dados de acesso para a aba Config (usuários + catálogo de recursos)

  const carregarAcesso = useCallback(async () => {
    try {
      const [us, recs] = await Promise.all([api.usuarios(), api.recursos()]);
      setUsersLista(us);
      setRecursosLista(recs);
    } catch (e: any) {
      // ignore
    }
  }, []);

  // Múltiplas reservas: N períodos futuros por campanha, cada um com toast
  const abrirReservas = async (row: PlanilhaRow) => {
    let id: string | undefined = row.id;
    if (!id) {
      const camp = await api
        .campanhas()
        .then((cs) =>
          cs.find((c: any) => c.anunciante === row.anunciante && c.led_codigo === row.led),
        )
        .catch(() => null);
      if (!camp) return;
      id = camp.id;
    }
    if (!id) return;
    setResMenu({ campId: id, anunciante: row.anunciante, led: row.led });
    setResMsg(null);
    setResForm({ anunciante: '', inicio: '2026-12-01', fim: '2026-12-31' });
    try {
      setResLista(await api.reservas(id));
    } catch (e: any) {
      setResMsg({ tipo: 'erro', texto: e.message });
    }
  };
  const salvarReserva = async () => {
    if (!resMenu) return;
    setResMsg(null);
    try {
      await api.criarReserva(resMenu.campId, resForm);
      setResLista(await api.reservas(resMenu.campId));
      setResMsg({ tipo: 'ok', texto: 'Reserva adicionada — avisaremos o início próximo.' });
      carregar();
    } catch (e: any) {
      setResMsg({ tipo: 'erro', texto: e.message });
    }
  };
  const excluirReserva = async (id: string) => {
    if (!resMenu || !confirm('Excluir esta reserva?')) return;
    try {
      await api.excluirReserva(id);
      setResLista(await api.reservas(resMenu.campId));
      carregar();
    } catch (e: any) {
      setResMsg({ tipo: 'erro', texto: e.message });
    }
  };

  // Aba de reservas: carrega lista global + campanhas ao abrir
  // (campanha vazia = automática; LED mantém o escolhido)
  const carregarAbaReservas = useCallback(async () => {
    try {
      const [lista, camps] = await Promise.all([api.listarReservas(cidade), api.campanhas()]);
      setResListaG(lista);
      setResCamps(camps);
    } catch (e: any) {
      setResMsgG({ tipo: 'erro', texto: e.message });
    }
  }, [cidade]);
  useEffect(() => {
    if (tab === 'reservas' && can('reservas')) {
      setTimeout(() => carregarAbaReservas(), 0);
    }
  }, [tab, me, cidade]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tela !== 'config') return;
    if (configSecao === 'acesso' && !can('usuarios')) {
      if (can('cidades')) setConfigSecao('cidades');
      else if (can('config')) setConfigSecao('tema');
      else if (can('importar')) setConfigSecao('importar');
    } else if (configSecao === 'cidades' && !can('cidades')) {
      if (can('usuarios')) setConfigSecao('acesso');
      else if (can('config')) setConfigSecao('tema');
      else if (can('importar')) setConfigSecao('importar');
    } else if ((configSecao === 'tema' || configSecao === 'logo') && !can('config')) {
      if (can('usuarios')) setConfigSecao('acesso');
      else if (can('cidades')) setConfigSecao('cidades');
      else if (can('importar')) setConfigSecao('importar');
    } else if (configSecao === 'importar' && !can('importar')) {
      if (can('usuarios')) setConfigSecao('acesso');
      else if (can('cidades')) setConfigSecao('cidades');
      else if (can('config')) setConfigSecao('tema');
    } else if (configSecao === 'perfil') {
      // Perfil é sempre acessível ao próprio usuário
    }
    if (can('usuarios')) {
      setTimeout(() => carregarAcesso(), 0);
    }
  }, [tela, me]); // eslint-disable-line react-hooks/exhaustive-deps

  // Menu global de reservas: lista tudo + criar/editar/excluir
  const [resModal, setResModal] = useState(false);
  // Backup: baixa o banco (JSON) e restaura
  const [bkMsg, setBkMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const conteudoReservas = () => (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table className={isTablet ? 'table-card' : ''}>
          <thead>
            <tr>
              <th>Anunciante</th>
              <th>LED</th>
              <th>Cidade</th>
              <th>Início</th>
              <th>Fim</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {resListaG.map((r: any) => (
              <tr key={r.id}>
                <td data-label="Anunciante"><b>{r.anunciante}</b></td>
                <td data-label="LED">{r.led_codigo}</td>
                <td data-label="Cidade">{r.cidade_nome}</td>
                <td data-label="Início">{br(r.inicio)}</td>
                <td data-label="Fim">{br(r.fim)}</td>
                <td className="row-actions" data-label="Ações">
                  <button onClick={() => abrirEdicaoReserva(r)}>Editar</button>
                  <button className="danger" onClick={() => excluirReservaGlobal(r.id)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {resListaG.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--muted)', textAlign: 'center' }}>
                  Nenhuma reserva cadastrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="spot-form">
        <h2 style={{ fontSize: '.85rem' }}>＋ NOVA RESERVA</h2>
        <div className="spot-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label>
            LED a reservar
            <select
              value={resFormG.led_codigo}
              onChange={(e) =>
                setResFormG({ ...resFormG, led_codigo: e.target.value, campanha_id: '' })
              }
            >
              <option value="">— escolher LED —</option>
              {(ledsLista.length ? ledsLista : dash.gantt_por_led).map((l: any) => (
                <option key={l.codigo} value={l.codigo}>
                  {l.codigo}
                </option>
              ))}
            </select>
          </label>
          <label>
            Campanha (vazio = automática: cria reservada se faltar)
            <select
              value={resFormG.campanha_id}
              onChange={(e) => setResFormG({ ...resFormG, campanha_id: e.target.value })}
            >
              <option value="">— automática —</option>
              {resCamps
                .filter((c: any) => !resFormG.led_codigo || c.led_codigo === resFormG.led_codigo)
                .map((c: any) => (
                  <option key={c.id} value={c.id}>
                    {c.anunciante} · {c.led_codigo} ({br(c.inicio)}→{br(c.fim)})
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="spot-row" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
          <label>
            Anunciante (vazio = o da campanha)
            <input
              value={resFormG.anunciante}
              onChange={(e) => setResFormG({ ...resFormG, anunciante: e.target.value })}
            />
          </label>
          <label>
            Início
            <input
              type="date"
              value={resFormG.inicio}
              onChange={(e) => setResFormG({ ...resFormG, inicio: e.target.value })}
            />
          </label>
          <label>
            Fim
            <input
              type="date"
              value={resFormG.fim}
              onChange={(e) => setResFormG({ ...resFormG, fim: e.target.value })}
            />
          </label>
        </div>
        {resMsgG && (
          <p className={`spot-msg ${resMsgG.tipo === 'ok' ? 'ok' : 'erro'}`}>{resMsgG.texto}</p>
        )}
        <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
          <button onClick={salvarReservaGlobal}>Adicionar reserva</button>
        </div>
      </div>
    </>
  );
  // Menu global de reservas: lista tudo + criar/editar/excluir
  const abrirReservasMenu = async () => {
    setResModal(true);
    setResMsgG(null);
    carregarAbaReservas();
  };
  // Janela independente de edição: não usa o formulário de criação
  const abrirEdicaoReserva = (r: any) => {
    const camp = resCamps.find((c: any) => c.id === r.campanha_id);
    setResMsgM(null);
    setResEditM({
      id: r.id,
      campLabel: camp
        ? `${camp.anunciante} · ${camp.led_codigo} (${br(camp.inicio)}→${br(camp.fim)})`
        : r.campanha_id,
      anunciante: r.anunciante,
      inicio: r.inicio,
      fim: r.fim,
    });
  };
  const salvarEdicaoReserva = async () => {
    if (!resEditM) return;
    setResMsgM(null);
    try {
      await api.editarReserva(resEditM.id, {
        anunciante: resEditM.anunciante,
        inicio: resEditM.inicio,
        fim: resEditM.fim,
      });
      setResEditM(null);
      setResListaG(await api.listarReservas(cidade));
      setResMsgG({ tipo: 'ok', texto: 'Reserva atualizada.' });
      carregar();
    } catch (e: any) {
      setResMsgM({ tipo: 'erro', texto: e.message });
    }
  };
  const salvarReservaGlobal = async () => {
    setResMsgG(null);
    if (!resFormG.inicio || !resFormG.fim) {
      setResMsgG({ tipo: 'erro', texto: 'Informe o período.' });
      return;
    }
    try {
      let msg: string | null = null;
      if (resFormG.campanha_id) {
        await api.criarReserva(resFormG.campanha_id, resFormG);
      } else {
        if (!resFormG.led_codigo || !resFormG.anunciante.trim()) {
          setResMsgG({ tipo: 'erro', texto: 'Escolha o LED e o anunciante (ou uma campanha).' });
          return;
        }
        const r = await api.criarReservaLed({
          led_codigo: resFormG.led_codigo,
          anunciante: resFormG.anunciante,
          inicio: resFormG.inicio,
          fim: resFormG.fim,
        });
        if (r.campanha_criada)
          msg = 'Reserva salva (campanha reservada criada) — avisaremos o início.';
      }
      setResFormG({
        campanha_id: '',
        led_codigo: resFormG.led_codigo,
        anunciante: '',
        inicio: '2026-12-01',
        fim: '2026-12-31',
      });
      setResListaG(await api.listarReservas(cidade));
      setResMsgG({ tipo: 'ok', texto: msg || 'Reserva salva — avisaremos o início próximo.' });
      carregar();
    } catch (e: any) {
      setResMsgG({ tipo: 'erro', texto: e.message });
    }
  };
  const excluirReservaGlobal = async (id: string) => {
    if (!confirm('Excluir esta reserva?')) return;
    try {
      await api.excluirReserva(id);
      setResListaG(await api.listarReservas(cidade));
      carregar();
    } catch (e: any) {
      setResMsgG({ tipo: 'erro', texto: e.message });
    }
  };

  // Menu de cidades: incluir / editar / excluir (conforme tabela cidades)
  const salvarCidade = async () => {
    setCidMsg(null);
    if (!cidForm.id.trim() || !cidForm.nome.trim()) {
      setCidMsg({ tipo: 'erro', texto: 'Preencha id e nome.' });
      return;
    }
    try {
      if (cidEditando) {
        await api.editarCidade(cidEditando, {
          nome: cidForm.nome,
          uf: cidForm.uf,
          fuso: cidForm.fuso,
        });
        setCidMsg({ tipo: 'ok', texto: 'Cidade atualizada.' });
      } else {
        const { status, body } = await api.criarCidade(cidForm);
        if (status !== 201) {
          setCidMsg({ tipo: 'erro', texto: body?.erro || `Falha (HTTP ${status}).` });
          return;
        }
        setCidMsg({ tipo: 'ok', texto: `Cidade ${cidForm.nome} cadastrada.` });
      }
      setCidForm({ id: '', nome: '', uf: '', fuso: 'America/Maceio' });
      setCidEditando(null);
      carregar();
    } catch (e: any) {
      setCidMsg({ tipo: 'erro', texto: e.message });
    }
  };
  const excluirCidade = async (id: string) => {
    if (!confirm(`Excluir a cidade "${id}"? (só vazia)`)) return;
    try {
      await api.excluirCidade(id);
      carregar();
    } catch (e: any) {
      setCidMsg({ tipo: 'erro', texto: e.message });
    }
  };

  // Tema: salva paleta e reaplica
  // Menu de LEDs: incluir / editar / excluir (com total de espaços individual)
  const salvarLed = async () => {
    setLedMsg(null);
    if (!ledForm.codigo.trim() || !ledForm.endereco.trim() || !ledForm.cidade_id) {
      setLedMsg({ tipo: 'erro', texto: 'Preencha código, endereço e cidade.' });
      return;
    }
    const esp = ledForm.espacos === '' ? null : Number(ledForm.espacos);
    if (esp !== null && (!Number.isInteger(esp) || esp < 1)) {
      setLedMsg({ tipo: 'erro', texto: 'Espaços deve ser inteiro ≥ 1 (ou vazio = padrão).' });
      return;
    }
    try {
      if (ledEditando) {
        await api.editarLed(ledEditando, {
          endereco: ledForm.endereco,
          cidade_id: ledForm.cidade_id,
          espacos_total: esp,
          ...(ledForm.codigo !== ledEditando ? { novo_codigo: ledForm.codigo } : {}),
        });
        setLedMsg({ tipo: 'ok', texto: 'LED atualizado.' });
      } else {
        const { status, body } = await api.criarLed({ ...ledForm, espacos_total: esp });
        if (status !== 201) {
          setLedMsg({ tipo: 'erro', texto: body?.erro || `Falha (HTTP ${status}).` });
          return;
        }
        setLedMsg({
          tipo: 'ok',
          texto: `LED ${ledForm.codigo} cadastrado (${esp ?? 'padrão'} espaços).`,
        });
      }
      setLedForm({ codigo: '', endereco: '', cidade_id: ledForm.cidade_id, espacos: '' });
      setLedEditando(null);
      carregar();
    } catch (e: any) {
      setLedMsg({ tipo: 'erro', texto: e.message });
    }
  };
  const excluirLed = async (codigo: string) => {
    if (!confirm(`Excluir o LED ${codigo}? (só vazio)`)) return;
    try {
      await api.excluirLed(codigo);
      carregar();
    } catch (e: any) {
      setLedMsg({ tipo: 'erro', texto: e.message });
    }
  };

  if (!token) {
    return (
      <Login
        token={token}
        login={login}
        setLogin={setLogin}
        senha={senha}
        setSenha={setSenha}
        logando={logando}
        setLogando={setLogando}
        loginErro={loginErro}
        setLoginErro={setLoginErro}
        logo={logo}
        onLogin={(r) => {
          localStorage.setItem('led_token', r.token);
          localStorage.setItem('led_perfil', r.perfil);
          setToken(r.token);
          setPerfil(r.perfil);
          setDismissed([]);
          carregar();
          if (localStorage.getItem('led_onboarding') !== '1') setOnboarding(true);
        }}
      />
    );
  }

  const pendentes = notifs.filter((n) => !n.lida);
  const visiveis = pendentes.filter((n) => !dismissed.includes(n.id));
  return (
    <>
      <div className="toasts" role="alert">
        {can('notificacoes') && visiveis.length > 1 && (
          <button
            className="toasts-close"
            onClick={() => setDismissed((xs) => [...xs, ...visiveis.map((n) => n.id)])}
          >
            ✕ fechar todas ({visiveis.length})
          </button>
        )}
        {can('notificacoes') &&
          visiveis
            .slice(0, 4)
            .map((n) => (
              <ToastItem
                key={n.id}
                n={n}
                onView={() => verCampanha(n)}
                onClose={() => setDismissed((xs) => [...xs, n.id])}
              />
            ))}
      </div>

      <div className="wrap">
        <div className="topbar">
          <div className="topbar-main">
            <div className="brand">
              {logo ? (
                <img className="brand-logo" src={logo} alt="logo" />
              ) : (
                <div className="icon">📺</div>
              )}
              <div>
                <h1>CONTROLE DE LED</h1>
                <span>PAINÉIS DE VEICULAÇÃO</span>
              </div>
            </div>
            <span className="live">● LIVE{online ? '' : ' · OFFLINE'}</span>
            <div className="kpis">
              <div className="kpi">
                <label>OCUPAÇÃO MÉDIA</label>
                <b>{dash.kpis.ocupacao_media}%</b>
              </div>
              <div className="kpi">
                <label>LEDS ATIVOS</label>
                <b>{dash.kpis.leds_ativos}</b>
              </div>
              <div className="kpi">
                <label>A VENCER (7D)</label>
                <b style={{ color: 'var(--orange)' }}>{dash.kpis.a_vencer_7d}</b>
              </div>
              <div className="kpi">
                <label>DISPONÍVEIS</label>
                <b style={{ color: 'var(--teal)' }}>
                  {dash.kpis.livres}
                  <small>/{dash.kpis.espacos_total} espaços</small>
                </b>
              </div>
            </div>
          </div>
          <div className="topbar-actions">
            <div className="select">
              🏙️ Cidade:{' '}
              <select value={cidade} onChange={(e) => trocarCidade(e.target.value)}>
                <option value="">Todas ({cidadesOpts.length})</option>
                {cidadesOpts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>{' '}
              ▾
            </div>
            <div className="pill">📅 {dash.periodo}</div>
            {can('leds') && (
              <button
                className="pill"
                style={{ cursor: 'pointer' }}
                onClick={() => {
                  setLedsMenu(true);
                  setLedMsg(null);
                }}
              >
                <span style={{ marginRight: 6 }}>📺</span>Painéis de LED
              </button>
            )}
            {can('reservas') && (
              <button className="pill" style={{ cursor: 'pointer' }} onClick={abrirReservasMenu}>
                <span style={{ marginRight: 6 }}>🗓️</span>Reservas
              </button>
            )}
            {tela === 'painel' && temConfig && (
              <button
                className="pill"
                style={{ cursor: 'pointer' }}
                onClick={() => setTela('config')}
              >
                <span style={{ marginRight: 6 }}>⚙️</span>Configuração
              </button>
            )}
            {tela === 'config' && (
              <button
                className="pill"
                style={{ cursor: 'pointer' }}
                onClick={() => setTela('painel')}
              >
                <span style={{ marginRight: 6 }}>←</span>Voltar
              </button>
            )}
            {perfil && (
              <div className="pill" title="Perfil do usuário (spec §9.2)">
                <span style={{ marginRight: 6 }}>👤</span>
                {perfil}
                {isAdmin ? ' · admin' : ''}
              </div>
            )}
            <button
              className="topbar-menu-btn"
              aria-label="Menu"
              aria-expanded={mobileMenuOpen}
              aria-controls="topbar-menu"
              onClick={() => setMobileMenuOpen(v => !v)}
            >
              ☰
            </button>
            <div className={`topbar-menu ${mobileMenuOpen ? 'open' : ''}`} id="topbar-menu" role="menu">
              {can('leds') && (
                <button
                  className="pill"
                  role="menuitem"
                  onClick={() => { setLedsMenu(true); setLedMsg(null); }}
                >
                  <span style={{ marginRight: 6 }}>📺</span>Painéis de LED
                </button>
              )}
              {can('reservas') && (
                <button className="pill" role="menuitem" onClick={abrirReservasMenu}>
                  <span style={{ marginRight: 6 }}>🗓️</span>Reservas
                </button>
              )}
              {tela === 'painel' && temConfig && (
                <button
                  className="pill"
                  role="menuitem"
                  onClick={() => setTela('config')}
                >
                  <span style={{ marginRight: 6 }}>⚙️</span>Configuração
                </button>
              )}
              {tela === 'config' && (
                <button
                  className="pill"
                  role="menuitem"
                  onClick={() => setTela('painel')}
                >
                  <span style={{ marginRight: 6 }}>←</span>Voltar
                </button>
              )}
              <button className="btn-sair" role="menuitem" onClick={sair} style={{width:'100%',justifyContent:'flex-start'}}>
                Sair
              </button>
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            {can('notificacoes') && (
              <button
                className="bell"
                onClick={() => setSino((v) => !v)}
                aria-expanded={sino}
                aria-haspopup="true"
                aria-controls="notificacoes-panel"
              >
                <span style={{ marginRight: 6 }} aria-hidden="true">
                  🔔
                </span>
                <span>Notificações</span>
                {pendentes.length > 0 && <span className="count">{pendentes.length}</span>}
              </button>
            )}
            {sino && can('notificacoes') && (
              <div
                className="notif-panel"
                id="notificacoes-panel"
                role="menu"
                aria-label="Central de notificações"
              >
                <h3>Central de notificações</h3>
                {notifs.length === 0 && <div className="item">Nenhuma notificação.</div>}
                {notifs.slice(0, 20).map((n) => (
                  <div key={n.id} className="item" style={n.lida ? { opacity: 0.55 } : undefined}>
                    <b>{n.titulo}</b>
                    <br />
                    {n.corpo}
                    {!n.lida && (
                      <div className="actions">
                        <button onClick={() => verCampanha(n)}>Ver campanha</button>
                        <button
                          onClick={() => {
                            if (online && n.id > 0)
                              api
                                .marcarLida(n.id)
                                .then(carregar)
                                .catch(() => {});
                            setNotifs((xs) =>
                              xs.map((x) => (x.id === n.id ? { ...x, lida: true } : x)),
                            );
                          }}
                        >
                          Marcar como lida
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="btn-sair" onClick={sair}>
            Sair
          </button>
        </div>
        <div className="breadcrumb">
          Todas as cidades <span>→</span> <b>{cidadeNome(cidade)}</b>
          {ledSel && (
            <>
              <span>→</span> <b>{ledSel}</b>
            </>
          )}
        </div>

        {tela === 'painel' && (
          <>
            <div className="grid">
              <div className="card">
                <h2>OCUPAÇÃO POR LED</h2>
                <p className="sub">
                  Linha do tempo de campanhas veiculando / reservadas por painel —{' '}
                  {cidadeNome(cidade)}.
                </p>
                {dash.gantt_por_led.map((l) => {
                  const usados = l.espacos_usados ?? l.campanhas.length;
                  const total = l.espacos_total ?? 8;
                  const pct = Math.min(100, Math.round((usados / Math.max(1, total)) * 100));
                  return (
                    <div
                      key={l.codigo}
                      className={`ledrow ${ledSel === l.codigo ? 'sel' : ''}`}
                      onClick={() => setLedSel((s) => (s === l.codigo ? null : l.codigo))}
                      title={l.campanhas
                        .map((c: any) => `${c.anunciante} ${br(c.inicio)}→${br(c.fim)}`)
                        .join(' · ')}
                    >
                      <div className="ledname">
                        {l.codigo}
                        <small>{l.endereco}</small>
                        <span
                          className="slots"
                          title={`${usados} de ${total} espaços de cliente ocupados`}
                        >
                          <span className="slots-bar">
                            <span style={{ width: `${pct}%` }} />
                          </span>
                          {usados}/{total}
                        </span>
                      </div>
                      <div className="track">
                        {ganttBlocos(l.campanhas).map((b, i) => (
                          <div
                            key={i}
                            className={`seg ${b.cls}`}
                            style={{ width: `${b.w}%` }}
                            title={b.title}
                          >
                            {b.showLabel && b.label}
                          </div>
                        ))}
                        {isMobile && (
                          <div className="track-labels" aria-hidden="true">
                            {ganttBlocos(l.campanhas).map((b, i) => (
                              <div
                                key={i}
                                className={`track-label ${b.cls}`}
                                style={{ width: `${b.w}%` }}
                                title={b.title}
                              >
                                {b.label}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                {ledSel && podeEditar && (
                  <button
                    className="pill"
                    style={{ cursor: 'pointer', marginTop: 8 }}
                    onClick={() => abrirNovaCampanha(ledSel)}
                  >
                    + Nova campanha em {ledSel}
                  </button>
                )}
              </div>

              <div className="card">
                <h2>DISTRIBUIÇÃO POR STATUS</h2>
                <p className="sub">Ocupação geral da rede no período.</p>
                <div className="toolbar" style={{ marginBottom: 4 }}>
                  {(
                    [
                      ['rosca', 'Rosca'],
                      ['pizza', 'Pizza'],
                      ['barras', 'Barras'],
                    ] as const
                  ).map(([id, lb]) => (
                    <button
                      key={id}
                      className={tipoDist === id ? undefined : 'ghost'}
                      onClick={() => setTipoDist(id)}
                    >
                      {lb}
                    </button>
                  ))}
                </div>
                {tipoDist !== 'barras' ? (
                  <div className="donutwrap">
                    <ResponsiveContainer width={170} height={170}>
                      <PieChart>
                        <Pie
                          data={dash.distribuicao}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={tipoDist === 'rosca' ? 52 : 0}
                          outerRadius={72}
                          paddingAngle={2}
                          strokeWidth={0}
                        >
                          {dash.distribuicao.map((d) => (
                            <Cell key={d.name} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="legend">
                      {dash.distribuicao.map((d) => (
                        <div key={d.name}>
                          <span className="dot" style={{ background: d.color }} />
                          {d.name}
                          <b>{d.value}%</b>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height={170}>
                    <BarChart data={dash.distribuicao} layout="vertical">
                      <CartesianGrid stroke={tema.vars.border || '#232d4a'} strokeDasharray="3 3" />
                      <XAxis
                        type="number"
                        stroke={tema.vars.muted || '#8b93ab'}
                        fontSize={11}
                        domain={[0, 100]}
                      />
                      <YAxis
                        type="category"
                        dataKey="name"
                        stroke={tema.vars.muted || '#8b93ab'}
                        fontSize={11}
                        width={80}
                      />
                      <Tooltip
                        contentStyle={{
                          background: tema.vars.panel2 || '#0f1730',
                          border: `1px solid ${tema.vars.border || '#232d4a'}`,
                        }}
                      />
                      <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                        {dash.distribuicao.map((d) => (
                          <Cell key={d.name} fill={d.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            <div className="grid2" style={{ marginBottom: 18 }}>
              <div className="card">
                <h2>OCUPAÇÃO POR CIDADE</h2>
                <p className="sub">Ranking de ocupação (%). Clique para filtrar.</p>
                <div className="bars">
                  {dash.ocupacao_por_cidade.map((b) => (
                    <div key={b.cidade} className="bar" onClick={() => trocarCidade(b.id || '')}>
                      <div
                        className={`val ${b.valor === 0 ? 'empty' : ''}`}
                        style={{ height: `${Math.max(b.valor, 2)}%` }}
                      >
                        <span style={b.valor === 0 ? { color: 'var(--muted)' } : undefined}>
                          {b.valor === 0 ? '—' : `${b.valor}%`}
                        </span>
                      </div>
                      <label>{b.cidade}</label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <h2>CAMPANHAS — A VENCER ({dash.a_vencer_lista.length})</h2>
                <p className="sub">
                  {dash.a_vencer_lista.length} campanhas em{' '}
                  {new Set(dash.a_vencer_lista.map((a) => a.led)).size} LEDs · fim − hoje ≤ 7d
                  (mesma base do topo).
                </p>
                <div style={{ overflowX: 'auto', maxHeight: 220, overflowY: 'auto' }}>
                  <table className={isTablet ? 'table-card' : ''}>
                    <thead>
                      <tr>
                        <th>Anunciante</th>
                        <th>LED</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dash.a_vencer_lista.map((a, i) => (
                        <tr key={i}>
                          <td data-label="Anunciante">{a.anunciante}</td>
                          <td data-label="LED">{a.led}</td>
                          <td data-label="Status">
                            <span className="status-dot" style={{ background: 'var(--orange)' }} />
                            {a.status}
                            {a.dias !== undefined && (
                              <small style={{ color: 'var(--muted)' }}>
                                {' '}
                                · {a.dias === 0 ? 'hoje' : `${a.dias}d`}
                              </small>
                            )}
                          </td>
                        </tr>
                      ))}
                      {dash.a_vencer_lista.length === 0 && (
                        <tr>
                          <td colSpan={3} style={{ color: 'var(--muted)' }}>
                            Nenhuma vencendo no período.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <h2 style={{ marginTop: 16 }}>
                  CAMPANHAS — A INICIAR ({(dash.a_iniciar_lista || []).length})
                </h2>
                <p className="sub">Início próximo · início − hoje ≤ 7d.</p>
                <div style={{ overflowX: 'auto', maxHeight: 220, overflowY: 'auto' }}>
                  <table className={isTablet ? 'table-card' : ''}>
                    <thead>
                      <tr>
                        <th>Anunciante</th>
                        <th>LED</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(dash.a_iniciar_lista || []).map((a, i) => (
                        <tr key={i}>
                          <td data-label="Anunciante">{a.anunciante}</td>
                          <td data-label="LED">{a.led}</td>
                          <td data-label="Status">
                            <span className="status-dot" style={{ background: 'var(--blue)' }} />
                            {a.status}
                            {a.dias !== undefined && (
                              <small style={{ color: 'var(--muted)' }}> · em {a.dias}d</small>
                            )}
                          </td>
                        </tr>
                      ))}
                      {(dash.a_iniciar_lista || []).length === 0 && (
                        <tr>
                          <td colSpan={3} style={{ color: 'var(--muted)' }}>
                            Nenhuma iniciando no período.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="card" ref={painelRef} style={{ marginBottom: 18, scrollMarginTop: 12 }}>
              <div className="tabs">
                <div
                  className={`tab ${tab === 'dashboard' ? 'active' : ''}`}
                  onClick={() => setTab('dashboard')}
                >
                  Dashboard
                </div>
                {(can('planilha') || !online) && (
                  <div
                    className={`tab ${tab === 'planilha' ? 'active' : ''}`}
                    onClick={() => setTab('planilha')}
                  >
                    Visualizar como planilha
                  </div>
                )}
                {(can('relatorios') || !online) && (
                  <div
                    className={`tab ${tab === 'relatorios' ? 'active' : ''}`}
                    onClick={() => setTab('relatorios')}
                  >
                    Relatórios
                  </div>
                )}
                {(can('graficos') || !online) && (
                  <div
                    className={`tab ${tab === 'graficos' ? 'active' : ''}`}
                    onClick={() => setTab('graficos')}
                  >
                    Gráficos
                  </div>
                )}
                {can('reservas') && (
                  <div
                    className={`tab ${tab === 'reservas' ? 'active' : ''}`}
                    onClick={() => setTab('reservas')}
                  >
                    Reservas
                  </div>
                )}
              </div>

              {tab === 'planilha' && (can('planilha') || !online) && (
                <>
                  <div className="toolbar">
                    <input
                      placeholder="🔍 Buscar…"
                      value={q}
                      onChange={(e) => {
                        setQ(e.target.value);
                        setSelecionadas([]);
                      }}
                    />
                    <select
                      value={stFilter}
                      onChange={(e) => {
                        setStFilter(e.target.value);
                        setSelecionadas([]);
                      }}
                    >
                      <option value="">Todos os status</option>
                      {Object.keys(STATUS_ROTULO).map((s) => (
                        <option key={s} value={s}>
                          {STATUS_ROTULO[s]}
                        </option>
                      ))}
                    </select>
                    {podeEditar && (
                      <button onClick={() => abrirNovaCampanha()}>＋ Nova campanha</button>
                    )}
                    {podeEditar && selecionadas.length > 0 && (
                      <button className="danger" onClick={excluirSelecionadas}>
                        🗑 Excluir {selecionadas.length} selecionada(s)
                      </button>
                    )}
                    {can('exportar') && (
                      <button onClick={() => api.exportar('xlsx', cidade, q, stFilter)}>
                        ⬇ .xlsx
                      </button>
                    )}
                    {can('exportar') && (
                      <button onClick={() => api.exportar('csv', cidade, q, stFilter)}>
                        ⬇ .csv
                      </button>
                    )}
                    <button className="ghost" onClick={() => window.print()}>
                      🖨 PDF
                    </button>
                  </div>
                  {importMsg && <p className={`spot-msg ${importMsg.tipo}`}>{importMsg.texto}</p>}
                  <div style={{ overflowX: 'auto' }}>
                    <table className={isTablet ? 'table-card' : ''}>
                      <thead>
                        <tr>
                          {podeEditar && (
                            <th>
                              <input
                                type="checkbox"
                                title="Selecionar visíveis"
                                checked={
                                  linhas.length > 0 &&
                                  linhas.every((r) => !r.id || selecionadas.includes(r.id))
                                }
                                onChange={(e) => {
                                  if (e.target.checked)
                                    setSelecionadas((xs) => [
                                      ...new Set([
                                        ...xs,
                                        ...(linhas.map((r) => r.id).filter(Boolean) as string[]),
                                      ]),
                                    ]);
                                  else
                                    setSelecionadas((xs) =>
                                      xs.filter((id) => !linhas.some((r) => r.id === id)),
                                    );
                                }}
                              />
                            </th>
                          )}
                          {[
                            ['cidade', 'Cidade'],
                            ['led', 'LED'],
                            ['anunciante', 'Anunciante'],
                            ['inicio', 'Início'],
                            ['fim', 'Fim'],
                            ['status', 'Status'],
                          ].map(([k, lb]) => (
                            <th
                              key={k}
                              onClick={() => {
                                if (k === sortK) setSortD((d) => (d === 1 ? -1 : 1));
                                else {
                                  setSortK(k);
                                  setSortD(1);
                                }
                              }}
                            >
                              {lb}
                              {sortK === k ? (sortD === 1 ? ' ▲' : ' ▼') : ''}
                            </th>
                          ))}
                          {podeEditar && <th>Ações</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {online ? (
                          linhas.length ? (
                            linhas.map((r, i) => (
                              <tr
                                key={r.id || i}
                                className={r.id && r.id === destaque ? 'destaque' : undefined}
                              >
                                {podeEditar && (
                                  <td data-label="✓">
                                    <input
                                      type="checkbox"
                                      checked={!!r.id && selecionadas.includes(r.id)}
                                      disabled={!r.id}
                                      onChange={() => r.id && alternarSelecao(r.id)}
                                    />
                                  </td>
                                )}
                                <td data-label="Cidade">{r.cidade}</td>
                                <td data-label="LED">{r.led}</td>
                                <td data-label="Anunciante">
                                  {editInline &&
                                  editInline.id === r.id &&
                                  editInline.campo === 'anunciante' ? (
                                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                                      <input
                                        value={editInline.valor}
                                        onChange={(e) =>
                                          setEditInline({ ...editInline!, valor: e.target.value })
                                        }
                                      />
                                      <button
                                        onClick={salvarEditInline}
                                        style={{ padding: '2px 8px', fontSize: '.7rem' }}
                                      >
                                        Salvar
                                      </button>
                                      <button
                                        onClick={cancelarEditInline}
                                        style={{ padding: '2px 8px', fontSize: '.7rem' }}
                                      >
                                        Cancelar
                                      </button>
                                    </div>
                                  ) : (
                                    <input
                                      defaultValue={r.anunciante}
                                      onClick={() => iniciarEditInline(r, 'anunciante')}
                                    />
                                  )}
                                </td>
                                <td data-label="Início">{br(r.inicio)}</td>
                                <td data-label="Fim">{br(r.fim)}</td>
                                <td data-label="Status">
                                  <span
                                    className="status-dot"
                                    style={{ background: corStatus(r.status) }}
                                  />
                                  {STATUS_ROTULO[r.status] || r.status}
                                  {r.status === 'a_vencer' &&
                                    r.fim !== '—' &&
                                    (() => {
                                      const d = diasAte(r.fim);
                                      const txt = d > 0 ? ` · ${d}d` : ' · encerra hoje';
                                      return <small style={{ color: 'var(--muted)' }}>{txt}</small>;
                                    })()}
                                </td>
                                {podeEditar && (
                                  <td className="row-actions" data-label="Ações">
                                    <button onClick={() => abrirEditarCampanha(r)}>Editar</button>
                                    <button onClick={() => abrirReservas(r)}>Reservas</button>
                                    <button className="danger" onClick={() => excluirCampanha(r)}>
                                      Excluir
                                    </button>
                                  </td>
                                )}
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td
                                colSpan={podeEditar ? 8 : 6}
                                style={{ color: 'var(--muted)', textAlign: 'center' }}
                              >
                                Nenhuma campanha para os filtros atuais.
                              </td>
                            </tr>
                          )
                        ) : (
                          <tr>
                            <td
                              colSpan={podeEditar ? 8 : 6}
                              style={{ color: 'var(--muted)', textAlign: 'center' }}
                            >
                              Sem dados - API offline. Ligue o back-end para carregar.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {tab === 'dashboard' && (
                <>
                  <p className="sub">
                    {online
                      ? `${linhas.length} campanha(s) no período · ${dash.periodo}`
                      : `Demonstração offline · ${dash.periodo}`}
                  </p>
                  <div style={{ overflowX: 'auto', maxHeight: 440, overflowY: 'auto' }}>
                    <table className={isTablet ? 'table-card' : ''}>
                      <thead>
                        <tr>
                          <th>Cidade</th>
                          <th>LED</th>
                          <th>Anunciante</th>
                          <th>Início</th>
                          <th>Fim</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {linhas.map((r, i) => (
                          <tr key={r.id || i}>
                            <td data-label="Cidade">{r.cidade}</td>
                            <td data-label="LED">{r.led}</td>
                            <td
                              data-label="Anunciante"
                              style={r.status === 'livre' ? { color: 'var(--muted)' } : undefined}
                            >
                              {r.anunciante}
                            </td>
                            <td data-label="Início">{br(r.inicio)}</td>
                            <td data-label="Fim">{br(r.fim)}</td>
                            <td data-label="Status">
                              <span
                                className="status-dot"
                                style={{ background: corStatus(r.status) }}
                              />
                              {STATUS_ROTULO[r.status] || r.status}
                            </td>
                          </tr>
                        ))}
                        {linhas.length === 0 && (
                          <tr>
                            <td colSpan={6} style={{ color: 'var(--muted)', textAlign: 'center' }}>
                              {online
                                ? 'Nenhuma campanha para os filtros atuais.'
                                : 'Sem dados - API offline. Ligue o back-end para carregar.'}
                            </td>
                          </tr>
                        )}
                        {online && linhas.length === 0 && (
                          <tr>
                            <td colSpan={6} style={{ color: 'var(--muted)', textAlign: 'center' }}>
                              Nenhuma campanha para os filtros atuais.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {tab === 'relatorios' && (can('relatorios') || !online) && (
                <>
                  <div className="toolbar">
                    <select value={relDim} onChange={(e) => setRelDim(e.target.value as any)}>
                      <option value="led">Por LED</option>
                      <option value="cidade">Por cidade</option>
                      <option value="cliente">Por cliente</option>
                    </select>
                    <select value={relCidade} onChange={(e) => setRelCidade(e.target.value)}>
                      <option value="">Todas as cidades</option>
                      {cidades.map((c: any) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}
                        </option>
                      ))}
                    </select>
                    <select value={relLed} onChange={(e) => setRelLed(e.target.value)}>
                      <option value="">Todos os LEDs</option>
                      {ledsLista.map((l: any) => (
                        <option key={l.codigo} value={l.codigo}>
                          {l.codigo}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="Cliente"
                      value={relAnu}
                      onChange={(e) => setRelAnu(e.target.value)}
                    />
                    <input type="date" value={relDe} onChange={(e) => setRelDe(e.target.value)} />
                    <input type="date" value={relAte} onChange={(e) => setRelAte(e.target.value)} />
                    <button onClick={gerarPdf}>Gerar PDF ({relFiltradas.length})</button>
                  </div>
                  <div className="toolbar">
                    {Object.keys(STATUS_ROTULO)
                      .filter((s) => s !== 'livre')
                      .map((s) => (
                        <label key={s} className="check">
                          <input
                            type="checkbox"
                            checked={relStatus.includes(s)}
                            onChange={() =>
                              setRelStatus((xs) =>
                                xs.includes(s) ? xs.filter((x) => x !== s) : [...xs, s],
                              )
                            }
                          />
                          {STATUS_ROTULO[s]}
                        </label>
                      ))}
                  </div>
                  {relMsg && <p className={`spot-msg ${relMsg.tipo}`}>{relMsg.texto}</p>}
                  <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
                    {relGrupos.map(([g, itens]) => (
                      <div key={g}>
                        <h2 style={{ fontSize: '.85rem', marginTop: 12 }}>
                          {g} ({itens.length})
                        </h2>
                        <table className={isTablet ? 'table-card' : ''}>
                          <thead>
                            <tr>
                              <th>Cidade</th>
                              <th>LED</th>
                              <th>Anunciante</th>
                              <th>Início</th>
                              <th>Fim</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {itens.map((r, i) => (
                              <tr key={r.id || i}>
                                <td data-label="Cidade">{r.cidade}</td>
                                <td data-label="LED">{r.led}</td>
                                <td data-label="Anunciante">{r.anunciante}</td>
                                <td data-label="Início">{br(r.inicio)}</td>
                                <td data-label="Fim">{br(r.fim)}</td>
                                <td data-label="Status">
                                  <span
                                    className="status-dot"
                                    style={{ background: corStatus(r.status) }}
                                  />
                                  {STATUS_ROTULO[r.status] || r.status}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                    {relGrupos.length === 0 && (
                      <p className="sub">Nenhuma campanha para os filtros.</p>
                    )}
                  </div>
                </>
              )}

              {tab === 'graficos' && (can('graficos') || !online) && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                  <div>
                    <h2 style={{ fontSize: '.85rem' }}>EVOLUÇÃO MENSAL (%)</h2>
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={dash.evolucao_mensal}>
                        <CartesianGrid
                          stroke={tema.vars.border || '#232d4a'}
                          strokeDasharray="3 3"
                        />
                        <XAxis dataKey="mes" stroke={tema.vars.muted || '#8b93ab'} fontSize={11} />
                        <YAxis
                          stroke={tema.vars.muted || '#8b93ab'}
                          fontSize={11}
                          domain={[40, 80]}
                        />
                        <Tooltip
                          contentStyle={{
                            background: tema.vars.panel2 || '#0f1730',
                            border: `1px solid ${tema.vars.border || '#232d4a'}`,
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="ocupacao"
                          stroke={tema.vars.teal || '#2dd4bf'}
                          strokeWidth={2}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div>
                    <h2 style={{ fontSize: '.85rem' }}>OCUPAÇÃO POR CIDADE (%)</h2>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={dash.ocupacao_por_cidade}>
                        <CartesianGrid
                          stroke={tema.vars.border || '#232d4a'}
                          strokeDasharray="3 3"
                        />
                        <XAxis
                          dataKey="cidade"
                          stroke={tema.vars.muted || '#8b93ab'}
                          fontSize={10}
                        />
                        <YAxis stroke={tema.vars.muted || '#8b93ab'} fontSize={11} />
                        <Tooltip
                          contentStyle={{
                            background: tema.vars.panel2 || '#0f1730',
                            border: `1px solid ${tema.vars.border || '#232d4a'}`,
                          }}
                        />
                        <Bar
                          dataKey="valor"
                          fill={tema.vars.teal || '#2dd4bf'}
                          radius={[6, 6, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {tab === 'reservas' && can('reservas') && (
                <>
                  <div className="toolbar">
                    <span className="sub">
                      Múltiplos períodos futuros por campanha, cada um com seu anunciante e toast de
                      início próximo.
                    </span>
                  </div>
                  {conteudoReservas()}
                </>
              )}
            </div>
          </>
        )}

        {tela === 'config' && temConfig && (
          <div className="card" style={{ marginBottom: 18 }}>
            <h2>CONFIGURAÇÕES</h2>
            <p className="sub">Acesso de usuários, cidades e cores do projeto.</p>
            <div className="tabs">
            {can('usuarios') && (
              <div
                className={`tab ${configSecao === 'acesso' ? 'active' : ''}`}
                onClick={() => setConfigSecao('acesso')}
              >
                Acesso
              </div>
            )}
            <div
              className={`tab ${configSecao === 'perfil' ? 'active' : ''}`}
              onClick={() => setConfigSecao('perfil')}
            >
              Meu Perfil
            </div>
              {can('cidades') && (
                <div
                  className={`tab ${configSecao === 'cidades' ? 'active' : ''}`}
                  onClick={() => setConfigSecao('cidades')}
                >
                  Cidades
                </div>
              )}
              {can('config') && (
                <div
                  className={`tab ${configSecao === 'tema' ? 'active' : ''}`}
                  onClick={() => setConfigSecao('tema')}
                >
                  Cores
                </div>
              )}
              {can('config') && (
                <div
                  className={`tab ${configSecao === 'logo' ? 'active' : ''}`}
                  onClick={() => setConfigSecao('logo')}
                >
                  Logo
                </div>
              )}
              {can('config') && (
                <div
                  className={`tab ${configSecao === 'backup' ? 'active' : ''}`}
                  onClick={() => setConfigSecao('backup')}
                >
                  Backup
                </div>
              )}
              {can('importar') && (
                <div
                  className={`tab ${configSecao === 'importar' ? 'active' : ''}`}
                  onClick={() => setConfigSecao('importar')}
                >
                  Importar
                </div>
              )}
            </div>
            {configSecao === 'acesso' && can('usuarios') && (
              <>
                <UsuariosSecao
                  usersLista={usersLista}
                  cidades={cidades}
                  recursosLista={recursosLista}
                  canUsuarios={can('usuarios')}
                  carregarAcesso={carregarAcesso}
                  carregar={carregar}
                />
              </>
            )}
            {configSecao === 'perfil' && (
              <>
                <PerfilSecao
                  perfil={perfil}
                  canUsuarios={can('usuarios')}
                  carregarAcesso={carregarAcesso}
                  carregar={carregar}
                />
              </>
            )}
            {configSecao === 'cidades' && can('cidades') && (
              <>
                <CidadesSecao
                  cidades={cidades}
                  canCidades={can('cidades')}
                  carregar={carregar}
                />
              </>
            )}
            {can('config') && configSecao === 'logo' && (
              <LogoSecao
                logo={logo}
                logoPrev={logoPrev}
                setLogo={setLogo}
                setLogoPrev={setLogoPrev}
                logoMsg={logoMsg}
                setLogoMsg={setLogoMsg}
                canConfig={can('config')}
              />
            )}
            {can('importar') && configSecao === 'importar' && (
              <ImportarSecao
                importMsg={importMsg}
                setImportMsg={setImportMsg}
                canImportar={can('importar')}
              />
            )}
            {can('config') && configSecao === 'backup' && (
              <BackupSecao
                bkMsg={bkMsg}
                setBkMsg={setBkMsg}
                canConfig={can('config')}
              />
            )}
            {can('config') && configSecao === 'tema' && (
              <TemaSecao
                tema={tema}
                setTema={setTema}
                temaMsg={temaMsg}
                setTemaMsg={setTemaMsg}
                canConfig={can('config')}
              />
            )}
          </div>
        )}

        <footer>
          <span>
            LATÊNCIA DE DADOS: {lat} · TODOS OS PAINÉIS REPORTANDO
            {online ? '' : ' · MODO OFFLINE (mockup)'}
          </span>
          <span>MOCKUP DE INTERFACE · PERÍODO: {dash.periodo.toUpperCase()}</span>
        </footer>
      </div>

      {modal && (
        <div
          className="modal-bg"
          onClick={() => {
            setModal(false);
            setEditCampId(null);
          }}
        >
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              {editCampId ? 'EDITAR CAMPANHA' : 'CADASTRAR CAMPANHA'} — {form.led_codigo}
            </h2>
            <p className="sub">
              Validação de datas ativa (31/9 é rejeitado — spec §1). Limite de 8 espaços de cliente
              por LED.
            </p>
            <input
              placeholder="Anunciante"
              value={form.anunciante}
              onChange={(e) => setForm({ ...form, anunciante: e.target.value })}
            />
            <select
              value={form.cidade_id}
              onChange={(e) => {
                const cid = e.target.value;
                const leds = ledsLista.length ? ledsLista : dash.gantt_por_led;
                const mesmoLed = leds.some(
                  (l: any) => l.codigo === form.led_codigo && l.cidade_id === cid,
                );
                const primeiro = leds.find((l: any) => l.cidade_id === cid);
                setForm({
                  ...form,
                  cidade_id: cid,
                  led_codigo: mesmoLed ? form.led_codigo : primeiro?.codigo || form.led_codigo,
                });
              }}
            >
              {(cidades.length ? cidades : [{ id: 'aracaju', nome: 'Aracaju', uf: 'SE' }]).map(
                (c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}/{c.uf}
                  </option>
                ),
              )}
            </select>
            <select
              value={form.led_codigo}
              onChange={(e) => {
                const led = (ledsLista.length ? ledsLista : dash.gantt_por_led).find(
                  (l: any) => l.codigo === e.target.value,
                );
                setForm({
                  ...form,
                  led_codigo: e.target.value,
                  cidade_id: led?.cidade_id || form.cidade_id,
                });
              }}
            >
              {(() => {
                const todos = ledsLista.length ? ledsLista : dash.gantt_por_led;
                const ops = todos.filter(
                  (l: any) => !form.cidade_id || l.cidade_id === form.cidade_id,
                );
                return (ops.length ? ops : todos).map((l: any) => (
                  <option key={l.codigo} value={l.codigo}>
                    {l.codigo}
                  </option>
                ));
              })()}
            </select>
            <input
              type="date"
              value={form.inicio}
              onChange={(e) => setForm({ ...form, inicio: e.target.value })}
            />
            <input
              type="date"
              value={form.fim}
              onChange={(e) => setForm({ ...form, fim: e.target.value })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={form.reservada}
                onChange={(e) => setForm({ ...form, reservada: e.target.checked })}
              />{' '}
              Campanha reservada (futura)
            </label>
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button onClick={criarCampanha}>Salvar</button>
              <button
                className="ghost"
                onClick={() => {
                  setModal(false);
                  setEditCampId(null);
                }}
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {resModal && can('reservas') && (
        <div
          className="modal-bg"
          onClick={() => {
            setResModal(false);
          }}
        >
          <div className="card modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h2>CADASTRO DE RESERVAS</h2>
            <p className="sub">
              Múltiplos períodos futuros por campanha, cada um com seu anunciante; cada um gera
              toast de início próximo.
            </p>
            {conteudoReservas()}
            <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
              <button
                className="ghost"
                onClick={() => {
                  setResModal(false);
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
      {resMenu && (
        <div className="modal-bg" onClick={() => setResMenu(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h2>RESERVAS — {resMenu.anunciante.toUpperCase()}</h2>
            <p className="sub">
              {resMenu.led} · múltiplos períodos futuros, cada um com seu anunciante; cada um gera
              toast de início próximo. Sem sobreposição com a campanha nem entre reservas.
            </p>
            <table className={isTablet ? 'table-card' : ''}>
              <thead>
                <tr>
                  <th>Anunciante</th>
                  <th>Início</th>
                  <th>Fim</th>
                  {podeEditar && <th>Ações</th>}
                </tr>
              </thead>
              <tbody>
                {resLista.map((r: any) => (
                  <tr key={r.id}>
                    <td data-label="Anunciante">{r.anunciante}</td>
                    <td data-label="Início">{br(r.inicio)}</td>
                    <td data-label="Fim">{br(r.fim)}</td>
                    {podeEditar && (
                      <td className="row-actions" data-label="Ações">
                        <button className="danger" onClick={() => excluirReserva(r.id)}>
                          Excluir
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {resLista.length === 0 && (
                  <tr>
                    <td colSpan={podeEditar ? 4 : 3} style={{ color: 'var(--muted)' }}>
                      Nenhuma reserva futura.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {podeEditar && (
              <div className="spot-form">
                <h2 style={{ fontSize: '.85rem' }}>＋ NOVA RESERVA</h2>
                <label>
                  Anunciante da reserva (vazio = o da campanha)
                  <input
                    placeholder={resMenu.anunciante}
                    value={resForm.anunciante}
                    onChange={(e) => setResForm({ ...resForm, anunciante: e.target.value })}
                  />
                </label>
                <div className="spot-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <label>
                    Início
                    <input
                      type="date"
                      value={resForm.inicio}
                      onChange={(e) => setResForm({ ...resForm, inicio: e.target.value })}
                    />
                  </label>
                  <label>
                    Fim
                    <input
                      type="date"
                      value={resForm.fim}
                      onChange={(e) => setResForm({ ...resForm, fim: e.target.value })}
                    />
                  </label>
                </div>
                {resMsg && (
                  <p className={`spot-msg ${resMsg.tipo === 'ok' ? 'ok' : 'erro'}`}>
                    {resMsg.texto}
                  </p>
                )}
                <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
                  <button onClick={salvarReserva}>Adicionar reserva</button>
                </div>
              </div>
            )}
            <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
              <button className="ghost" onClick={() => setResMenu(null)}>
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
      {ledsMenu && (
        <div
          className="modal-bg"
          onClick={() => {
            setLedsMenu(false);
            setLedEditando(null);
          }}
        >
          <div className="card modal modal-lg" onClick={(e) => e.stopPropagation()}>
            <h2>CADASTRO DE LEDS</h2>
            <p className="sub">
              Cada painel tem 8 espaços de cliente. Exclusão só de LED vazio; renomear move
              campanhas e spots juntos.
            </p>
            <div className="table-scroll">
              <table className={isTablet ? 'table-card' : ''}>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Endereço</th>
                    <th>Cidade</th>
                    <th>Espaços</th>
                    {podeEditar && <th>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {(ledsLista.length
                    ? ledsLista
                    : dash.gantt_por_led.map((l: any) => ({
                        codigo: l.codigo,
                        endereco: l.endereco,
                        cidade_id: l.cidade_id,
                        espacos_usados: l.espacos_usados ?? l.campanhas.length,
                        espacos_total: l.espacos_total ?? 8,
                      }))
                  ).map((l: any) => (
                    <tr key={l.codigo}>
                      <td data-label="Código"><b>{l.codigo}</b></td>
                      <td data-label="Endereço">{l.endereco}</td>
                      <td data-label="Cidade">{l.cidade_id}</td>
                      <td data-label="Espaços">
                        <span
                          className="slots"
                          title={`${l.espacos_usados} de ${l.espacos_total} espaços ocupados`}
                        >
                          <span className="slots-bar">
                            <span
                              style={{
                                width: `${Math.min(100, Math.round((l.espacos_usados / Math.max(1, l.espacos_total)) * 100))}%`,
                              }}
                            />
                          </span>
                          {l.espacos_usados}/{l.espacos_total}
                        </span>
                      </td>
                      {podeEditar && (
                        <td className="row-actions" data-label="Ações">
                          <button
                            onClick={() => {
                              setLedEditando(l.codigo);
                              setLedForm({
                                codigo: l.codigo,
                                endereco: l.endereco,
                                cidade_id: l.cidade_id,
                                espacos:
                                  l.espacos_proprio === null || l.espacos_proprio === undefined
                                    ? ''
                                    : String(l.espacos_proprio),
                              });
                            }}
                          >
                            Editar
                          </button>
                          <button className="danger" onClick={() => excluirLed(l.codigo)}>
                            Excluir
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {podeEditar && (
              <div className="spot-form">
                <h2 style={{ fontSize: '.85rem' }}>
                  {ledEditando ? `EDITAR ${ledEditando}` : '＋ NOVO LED'}
                </h2>
                <div className="spot-row" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
                  <label>
                    Código
                    <input
                      placeholder="AJU 05"
                      value={ledForm.codigo}
                      onChange={(e) =>
                        setLedForm({ ...ledForm, codigo: e.target.value.toUpperCase() })
                      }
                    />
                  </label>
                  <label>
                    Endereço
                    <input
                      placeholder="Av. ..."
                      value={ledForm.endereco}
                      onChange={(e) => setLedForm({ ...ledForm, endereco: e.target.value })}
                    />
                  </label>
                  <label>
                    Cidade
                    <select
                      value={ledForm.cidade_id}
                      onChange={(e) => setLedForm({ ...ledForm, cidade_id: e.target.value })}
                    >
                      {(cidades.length
                        ? cidades
                        : [{ id: 'aracaju', nome: 'Aracaju', uf: 'SE' }]
                      ).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nome}/{c.uf}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Espaços (vazio = padrão)
                    <input
                      type="number"
                      min={1}
                      placeholder="8"
                      value={ledForm.espacos}
                      onChange={(e) => setLedForm({ ...ledForm, espacos: e.target.value })}
                    />
                  </label>
                </div>
                {ledMsg && (
                  <p className={`spot-msg ${ledMsg.tipo === 'ok' ? 'ok' : 'erro'}`}>
                    {ledMsg.texto}
                  </p>
                )}
                <div className="toolbar" style={{ marginTop: 8, marginBottom: 0 }}>
                  <button onClick={salvarLed}>
                    {ledEditando ? 'Salvar alterações' : 'Cadastrar LED'}
                  </button>
                  {ledEditando && (
                    <button
                      className="ghost"
                      onClick={() => {
                        setLedEditando(null);
                        setLedForm({
                          codigo: '',
                          endereco: '',
                          cidade_id: ledForm.cidade_id,
                          espacos: '',
                        });
                      }}
                    >
                      Cancelar edição
                    </button>
                  )}
                </div>
              </div>
            )}
            <div className="toolbar" style={{ marginTop: 12, marginBottom: 0 }}>
              <button
                className="ghost"
                onClick={() => {
                  setLedsMenu(false);
                  setLedEditando(null);
                }}
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
      {resEditM && (
        <div className="modal-bg modal-fg" onClick={() => setResEditM(null)}>
          <div className="card modal" onClick={(e) => e.stopPropagation()}>
            <h2>EDITAR RESERVA</h2>
            <p className="sub">{resEditM.campLabel}</p>
            <label>
              Anunciante da reserva
              <input
                value={resEditM.anunciante}
                onChange={(e) => setResEditM({ ...resEditM, anunciante: e.target.value })}
              />
            </label>
            <div className="spot-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <label>
                Início
                <input
                  type="date"
                  value={resEditM.inicio}
                  onChange={(e) => setResEditM({ ...resEditM, inicio: e.target.value })}
                />
              </label>
              <label>
                Fim
                <input
                  type="date"
                  value={resEditM.fim}
                  onChange={(e) => setResEditM({ ...resEditM, fim: e.target.value })}
                />
              </label>
            </div>
            {resMsgM && (
              <p className={`spot-msg ${resMsgM.tipo === 'ok' ? 'ok' : 'erro'}`}>{resMsgM.texto}</p>
            )}
            <div className="toolbar" style={{ marginTop: 10 }}>
              <button onClick={salvarEdicaoReserva}>Salvar alterações</button>
              <button className="ghost" onClick={() => setResEditM(null)}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
      {onboarding && (
        <div className="modal-bg" onClick={() => {}} style={{ background: 'rgba(0,0,0,.85)' }}>
          <div
            className="card modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 520, textAlign: 'center' }}
          >
            <h2 style={{ fontSize: '1.2rem', marginBottom: 8 }}>Bem-vindo ao Controle de LED</h2>
            <p className="sub" style={{ marginBottom: 20 }}>
              Guia rápido para começar:
            </p>
            <div style={{ textAlign: 'left', marginBottom: 20 }}>
              <div style={{ marginBottom: 10, color: 'var(--text)' }}>
                <b>1.</b> Veja os painéis no Gantt e clique em um para criar campanhas.
              </div>
              <div style={{ marginBottom: 10, color: 'var(--text)' }}>
                <b>2.</b> Use Planilha para editar anunciante, datas e status em lote.
              </div>
              <div style={{ marginBottom: 10, color: 'var(--text)' }}>
                <b>3.</b> Reservas criam períodos futuros com aviso de início próximo.
              </div>
              <div style={{ marginBottom: 20, color: 'var(--text)' }}>
                <b>4.</b> Atalhos:{' '}
                <code style={{ background: 'var(--panel2)', padding: '2px 6px', borderRadius: 4 }}>
                  Ctrl+N
                </code>{' '}
                nova campanha ·{' '}
                <code style={{ background: 'var(--panel2)', padding: '2px 6px', borderRadius: 4 }}>
                  Ctrl+S
                </code>{' '}
                salvar ·{' '}
                <code style={{ background: 'var(--panel2)', padding: '2px 6px', borderRadius: 4 }}>
                  Esc
                </code>{' '}
                cancelar.
              </div>
            </div>
            <div className="toolbar" style={{ justifyContent: 'center', gap: 10 }}>
              <button
                className="ghost"
                onClick={() => {
                  setOnboarding(false);
                  localStorage.setItem('led_onboarding', '1');
                }}
              >
                Pular
              </button>
              <button
                onClick={() => {
                  setOnboarding(false);
                  localStorage.setItem('led_onboarding', '1');
                }}
              >
                Começar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
