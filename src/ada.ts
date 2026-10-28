// Tudo que o app fala com a API da ADA (repo ada-api).
import { fetch } from 'expo/fetch';

// o endereço vem do .env.local (fora do git): o Expo troca isto pelo valor na hora de compilar,
// e a tela nunca mostra nem pede IP
const ENDERECO = process.env.EXPO_PUBLIC_ADA_ENDERECO;

// respondendo: ela está gerando uma resposta agora (esse pedido não conta na fila)
export type Info = { pronta: boolean; respondendo: boolean; fila: number; terminal: boolean; fake: boolean };
export type Conversa = { id: string; titulo: string; atualizada: number; n: number; previa: string | null };
export type Tool = { nome: string; res: string };
export type Meta = { pensou_s: number; respondeu_s: number; tools: Tool[]; think: string };
// foto: o nome da foto na API (mensagem do usuário que mandou uma) ou null
export type Mensagem = { n: number; role: 'user' | 'assistant'; content: string; meta: Meta | null; foto: string | null };
export type ConversaAberta = { id: string; titulo: string; mensagens: Mensagem[]; gerando: boolean };

export type EventoChat =
  | { t: 'think' | 'resp'; d: string }
  | { t: 'tool'; nome: string; args: unknown; res: string }
  | { t: 'fim' }
  | { t: 'erro'; d: string };

export type EventoTerminal =
  | { t: 'saida'; d: string }
  | { t: 'fim'; codigo: number; s: number; pasta: string };

// status 0 = nem chegou na API (rede, Tailscale, endereço)
export class ErroDaAda extends Error {
  status: number;

  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

// ---------- os pedidos ----------

type Pedido = {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  corpo?: object;
  sessao?: string; // a do terminal, vai no Authorization
};

async function abrir(caminho: string, pedido: Pedido = {}) {
  if (!ENDERECO) {
    throw new ErroDaAda(0, 'falta o EXPO_PUBLIC_ADA_ENDERECO no .env.local');
  }
  const cabecalhos: Record<string, string> = { 'Content-Type': 'application/json' };
  if (pedido.sessao) {
    cabecalhos.Authorization = `Bearer ${pedido.sessao}`;
  }
  const resposta = await fetch(ENDERECO + caminho, {
    method: pedido.metodo ?? 'GET',
    headers: cabecalhos,
    body: pedido.corpo ? JSON.stringify(pedido.corpo) : undefined,
  }).catch(() => {
    throw new ErroDaAda(0, 'não consegui falar com a ADA (Tailscale ligado? API rodando?)');
  });
  if (!resposta.ok) {
    const corpo = await resposta.json().catch(() => ({}));
    throw new ErroDaAda(resposta.status, motivo(corpo, resposta.status));
  }
  return resposta;
}

// 400/401/404/409/423/503 vêm como {"erro"}; 422 e 429 no formato do FastAPI, {"detail"}
function motivo(corpo: { erro?: string; detail?: unknown }, status: number) {
  if (corpo.erro) return corpo.erro;
  if (typeof corpo.detail === 'string') return corpo.detail;
  if (status === 422) return 'pedido fora do formato';
  return `erro ${status}`;
}

async function pedirJson<T>(caminho: string, pedido?: Pedido): Promise<T> {
  const resposta = await abrir(caminho, pedido);
  return resposta.json();
}

export function comPrazo<T>(promessa: Promise<T>, ms: number): Promise<T> {
  const estouro = new Promise<T>((_, rejeitar) =>
    setTimeout(() => rejeitar(new ErroDaAda(0, 'a ADA não respondeu a tempo')), ms),
  );
  return Promise.race([promessa, estouro]);
}

// lê um stream SSE ("data: {...}\n\n") e entrega cada evento já como objeto, na hora que chega
async function lerEventos<T>(resposta: Awaited<ReturnType<typeof abrir>>, aoEvento: (evento: T) => void) {
  if (!resposta.body) return;
  const leitor = resposta.body.getReader();
  const decodificador = new TextDecoder();
  let sobra = '';
  while (true) {
    const { done, value } = await leitor.read();
    if (done) break;
    sobra += decodificador.decode(value, { stream: true });
    const blocos = sobra.split('\n\n');
    sobra = blocos.pop() ?? ''; // o último pode ter chegado pela metade
    for (const bloco of blocos) {
      if (bloco.startsWith('data: ')) {
        aoEvento(JSON.parse(bloco.slice('data: '.length)));
      }
    }
  }
}

// ---------- a ADA e as conversas ----------

export const info = () => pedirJson<Info>('/info');

export const listarConversas = () => pedirJson<Conversa[]>('/conversas');

export const criarConversa = (titulo: string) =>
  pedirJson<{ id: string; titulo: string }>('/conversas', { metodo: 'POST', corpo: { titulo } });

export const abrirConversa = (id: string) => pedirJson<ConversaAberta>(`/conversas/${id}`);

export const apagarConversa = (id: string) => pedirJson(`/conversas/${id}`, { metodo: 'DELETE' });

// a resposta quem grava é a API: se a conexão cair no meio, ela termina e grava igual;
// foto: o JPEG em base64 que o foto.ts preparou, ou null
export async function conversar(
  conversa: string,
  msg: string,
  foto: string | null,
  aoEvento: (evento: EventoChat) => void,
) {
  const corpo = foto ? { conversa, msg, foto } : { conversa, msg };
  const resposta = await abrir('/chat', { metodo: 'POST', corpo });
  await lerEventos(resposta, aoEvento);
}

// um pedaço da fala (WAV 16 kHz mono em base64) vira texto no ouvido da ADA (o Whisper no Mac);
// o comando é o "enviar" ou o "apagar" do fim, que a API já tira do texto
export type Ouvido = { texto: string; comando: 'enviar' | 'apagar' | null };
export const ouvir = (audio: string) => pedirJson<Ouvido>('/ouvir', { metodo: 'POST', corpo: { audio } });

// a foto de uma mensagem, servida pela API (a imagem do app busca direto deste endereço)
export const enderecoDaFoto = (conversa: string, nome: string) => `${ENDERECO}/conversas/${conversa}/fotos/${nome}`;

// o que a ficha e o cabeçalho mostram: só o que muda e importa
export function estadoDaAda(atual: Info | null, foraDoAr: boolean) {
  if (foraDoAr) return 'fora do ar';
  if (!atual) return '…';
  if (!atual.pronta) return 'carregando';
  if (atual.fila > 0) return `${atual.fila} na frente`;
  if (atual.respondendo) return 'ocupada';
  return 'pronta';
}

// carregando, ocupada ou com fila: o sinal fica âmbar, e a tela de voz não abre o microfone
export function adaNaoAtendeAgora(estado: string) {
  return estado === 'carregando' || estado === 'ocupada' || estado.endsWith('na frente');
}

// ---------- o terminal ----------

export const estadoDoTerminal = () => pedirJson<{ tem_senha: boolean }>('/terminal/estado');

// sem senha no banco, a API grava esta como a senha nova (só na primeira vez)
export const entrarNoTerminal = (senha: string) =>
  pedirJson<{ sessao: string; pasta: string }>('/terminal/entrar', { metodo: 'POST', corpo: { senha } });

export async function rodarComando(
  sessao: string,
  cmd: string,
  pasta: string,
  aoEvento: (evento: EventoTerminal) => void,
) {
  const resposta = await abrir('/terminal/rodar', { metodo: 'POST', corpo: { cmd, pasta }, sessao });
  await lerEventos(resposta, aoEvento);
}

export const pararComando = (sessao: string) =>
  pedirJson<{ sinal: string }>('/terminal/parar', { metodo: 'POST', sessao });

export const sairDoTerminal = (sessao: string) => pedirJson('/terminal/sair', { metodo: 'POST', sessao });
