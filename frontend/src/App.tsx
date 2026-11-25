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
  const [bootstrapMode, setBootstrapMode] = useState(false);
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
        bootstrap={bootstrapMode}
        setBootstrap={setBootstrapMode}
        onLogin={(r) => {
          localStorage.setItem('led_token', r.token);
          localStorage.setItem('led_perfil', r.perfil);
          setToken(r.token);
          setPerfil(r.perfil);
          setDismissed([]);
          carregar();
          if (localStorage.getItem('led_onboarding') !== '1') setOnboarding(true);
        }}
        onBootstrap={(r) => {
          localStorage.setItem('led_token', r.token);
          localStorage.setItem('led_perfil', r.perfil);
          localStorage.setItem('led_refresh_token', r.refresh_token);
          setToken(r.token);
          setPerfil(r.perfil);
          setBootstrapMode(false);
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

      <header>
        {logo ? (
          <img className="brand-logo" src={logo} alt="logo" />
        ) : (
          <div className="logo"><i>∿</i>CONTROLE LED <small>| PAINÉIS DE VEICULAÇÃO</small></div>
        )}
        <div className="search">Buscar região, painel ou anunciante…</div>
        <div className="chip">Período: <b>{dash.periodo}</b></div>
        <div className="chip s">Escopo: <b>{cidade ? cidadeNome(cidade) : 'Todas' } ({cidadesOpts.length})</b></div>
        <div className="sp"></div>
        <div className="live">● {online ? 'LIVE DATA' : 'OFFLINE'}</div>
        <div className="user">
          <i>{(perfil || 'U').charAt(0).toUpperCase()}{(perfil || 'U').slice(-1).toUpperCase()}</i>
          <div><b>{perfil || 'Usuário'}</b><span>{isAdmin ? 'Administrador' : 'Operador'}</span></div>
        </div>
      </header>

      <div className="wrap">
        <nav>
          <h6>ANALYTICS PANELS</h6>
          <a className={tab === 'dashboard' ? 'on' : ''} onClick={() => setTab('dashboard')}>Overview</a>
          <a className={tab === 'planilha' ? 'on' : ''} onClick={() => setTab('planilha')}>Planilha</a>
          <a className={tab === 'relatorios' ? 'on' : ''} onClick={() => setTab('relatorios')}>Relatórios</a>
          <a className={tab === 'graficos' ? 'on' : ''} onClick={() => setTab('graficos')}>Gráficos</a>
          {can('reservas') && <a className={tab === 'reservas' ? 'on' : ''} onClick={() => setTab('reservas')}>Reservas</a>}
          <h6 style={{ marginTop: 28 }}>SYSTEM &amp; REPORTS</h6>
          {can('leds') && <a onClick={() => { setLedsMenu(true); setLedMsg(null); }}>Painéis de LED</a>}
          {tela === 'painel' && temConfig && <a onClick={() => setTela('config')}>Configuração</a>}
          {tela === 'config' && <a onClick={() => setTela('painel')}>← Voltar ao painel</a>}
          <div className="model">
            <b>2026 Transit Model</b>
            <p>v4.8 Active Engine</p>
            <div className="bar"><span style={{ width: '62%', background: 'var(--bl)' }}></span></div>
            <p style={{ margin: '10px 0 0' }}>Sync Confidence: 94%</p>
            <a>Download Dataset →</a>
          </div>
        </nav>

        <main>
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
            <section className="card hero s4">
              <div className="t">MÉTRICA DE DESTAQUE</div>
              <div className="hero-title">Ocupação Média da Rede</div>
              <div className="big">
                <div className="n">{dash.kpis.ocupacao_media}</div>
                <div className="u"><b>%</b><span>de ocupação média por painel</span></div>
              </div>
              <span className="pill">{dash.kpis.a_vencer_7d} a vencer (7d)</span>
              <span style={{ color: 'var(--mut)', marginLeft: 10 }}>
                {dash.kpis.leds_ativos} painéis ativos
              </span>
            </section>

            {dash.distribuicao.map((d, i) => (
              <section key={d.name} className="card k">
                <h4>
                  <i
                    style={{
                      background: i === 0 ? '#0d2a45' : i === 1 ? '#0b2a26' : '#251a45',
                      color: i === 0 ? 'var(--bl)' : i === 1 ? 'var(--gr)' : 'var(--pu)',
                    }}
                  >
                    {i === 0 ? '✓' : i === 1 ? '○' : '⌃'}
                  </i>
                  {d.name}
                </h4>
                <div className="v">{d.value}%</div>
                <div className="bar">
                  <span
                    style={{
                      width: `${d.value}%`,
                      background: i === 0 ? 'var(--bl)' : i === 1 ? 'var(--gr)' : 'var(--pu)',
                    }}
                  />
                </div>
                <small>
                  <span className="up">↑</span> {d.name.toLowerCase()} no período
                </small>
              </section>
            ))}

            <section className="card s2">
              <h3>Distribuição por Status</h3>
              <p className="sub">Proporção de campanhas por status na rede</p>
              <div className="donut">
                <svg viewBox="0 0 200 200" role="img" aria-label="Distribuição por status">
                  <g fill="none" strokeWidth="28" pathLength="100">
                    {dash.distribuicao.map((d, i) => {
                      const offset = dash.distribuicao.slice(0, i).reduce((s, x) => s + x.value, 0);
                      return (
                        <circle
                          key={d.name}
                          cx="100"
                          cy="100"
                          r="76"
                          stroke={d.color}
                          pathLength="100"
                          strokeDasharray={`${d.value} 100`}
                          strokeDashoffset={-offset}
                        />
                      );
                    })}
                  </g>
                </svg>
                <div>
                  <b>100%</b>
                  <span>{dash.distribuicao.length} STATUS</span>
                </div>
              </div>
              <div className="leg" style={{ justifyContent: 'center' }}>
                {dash.distribuicao.map((d) => (
                  <span key={d.name} style={{ '--c': d.color } as any}>
                    {d.name}
                    <b>{d.value}%</b>
                  </span>
                ))}
              </div>
            </section>

            <section className="card s2">
              <h3>Ocupação por Cidade</h3>
              <p className="sub">Percentual de ocupação média por cidade no período</p>
              <div className="hist" id="hist">
                <div className="y">
                  <span>40%</span>
                  <span>30%</span>
                  <span>20%</span>
                  <span>10%</span>
                  <span>0%</span>
                </div>
                {dash.ocupacao_por_cidade.map((b, i) => (
                  <div key={b.cidade} className={`col${i > 3 ? ' x' : ''}`}>
                    <em>{b.valor}%</em>
                    <div className="b" style={{ height: `${Math.min(b.valor, 40) / 40 * 100}%` }} />
                    <label>{b.cidade}</label>
                  </div>
                ))}
                <div className="avg">
                  <span>Média: {dash.kpis.ocupacao_media}%</span>
                </div>
              </div>
              <div className="leg">
                <span style={{ '--c': 'var(--cy)' } as any}>
                  Cidades
                  <b>{dash.ocupacao_por_cidade.length}</b>
                </span>
              </div>
            </section>

            <section className="card">
              <h3>Evolução Mensal</h3>
              <p className="sub">Ocupação nos últimos 6 meses</p>
              <svg viewBox="0 0 300 270" width="100%" role="img" aria-label="Evolução mensal">
                <defs>
                  <linearGradient id="gradLine" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--cy)" />
                    <stop offset="100%" stopColor="var(--bl)" />
                  </linearGradient>
                </defs>
                <polyline
                  fill="none"
                  stroke="url(#gradLine)"
                  strokeWidth="3"
                  points={dash.evolucao_mensal
                    .map((m, i) => `${40 + i * 43.3},${250 - (m.ocupacao - 40) * 4.16}`)
                    .join(' ')}
                />
                {dash.evolucao_mensal.map((m, i) => (
                  <circle
                    key={m.mes}
                    cx={40 + i * 43.3}
                    cy={250 - (m.ocupacao - 40) * 4.16}
                    r="4"
                    fill="var(--cy)"
                  />
                ))}
                <g fontSize="12" fill="#8a97b3" textAnchor="middle">
                  {dash.evolucao_mensal.map((m, i) => (
                    <text key={m.mes} x={40 + i * 43.3} y={262}>
                      {m.mes}
                    </text>
                  ))}
                </g>
                <g fontSize="12" fill="var(--mut)" textAnchor="end">
                  {dash.evolucao_mensal.map((m, i) => (
                    <text key={m.mes} x={30} y={253 - (m.ocupacao - 40) * 4.16}>
                      {m.ocupacao}%
                    </text>
                  ))}
                </g>
              </svg>
              <div style={{ color: 'var(--mut)', fontSize: '12px' }}>
                Últimos 6 meses · média {Math.round(dash.kpis.ocupacao_media)}%
              </div>
            </section>

            <section className="card s2">
              <h3>Ocupação por Painel</h3>
              <p className="sub">Distribuição de espaços por painel LED</p>
              <div className="persona" id="persona">
                {dash.gantt_por_led.map((l) => {
                  const usados = l.espacos_usados ?? l.campanhas.length;
                  const total = l.espacos_total ?? 8;
                  return (
                    <div key={l.codigo}>
                      <b>{l.codigo}</b>
                      <div className="sq">
                        {[...Array(Math.min(usados, 3)).fill('#00e5ff'),
                          ...Array(Math.max(0, 3 - usados)).fill('#1c2845')].map((c, i) => (
                          <i key={i} style={{ background: c }} />
                        ))}
                      </div>
                      <span className="tag" style={{ color: 'var(--bl)', borderColor: 'var(--bl)', background: '#0b1d3a' }}>
                        {usados}/{total} espaços
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="leg" style={{ marginTop: 22 }}>
                <span style={{ '--c': 'var(--cy)' } as any}>Transit</span>
                <span style={{ '--c': 'var(--gr)' } as any}>Active / Micro</span>
                <span style={{ '--c': 'var(--or)' } as any}>Personal Vehicle</span>
              </div>
            </section>

            <section className="card s4">
              <h3>Top Campanhas — A Vencer</h3>
              <p className="sub">Campanhas com término nos próximos 7 dias</p>
              <table className="tbl">
                <thead>
                    <tr>
                      <th>ANUNCIANTE</th>
                      <th>PAINEL</th>
                      <th>TÉRMINO</th>
                      <th>STATUS</th>
                    </tr>
                </thead>
                <tbody id="rows">
                  {dash.a_vencer_lista.map((a) => (
                    <tr key={a.anunciante + a.led}>
                      <td>{a.anunciante}</td>
                      <td className="t">{a.led}</td>
                      <td>{br(a.fim || '')}</td>
                      <td>
                        <span className="tr">{a.status}</span>
                      </td>
                    </tr>
                  ))}
                  {dash.a_vencer_lista.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ color: 'var(--mut)', textAlign: 'center' }}>
                        Nenhuma campanha vencendo no período.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          </>
        )}

        </main>
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
