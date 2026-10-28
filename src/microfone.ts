// O microfone da tela de voz: grava a fala, corta nas pausas e entrega cada pedaço em WAV (pro /ouvir da API).
// Do celular só sai o pedaço de áudio, pro Mac; os arquivos dos pedaços (cache/AudioStream) são apagados.
import { type AudioStreamBuffer, requestRecordingPermissionsAsync, useAudioStream } from 'expo-audio';
import { Directory, File, Paths } from 'expo-file-system';
import { useRef } from 'react';
import { useSharedValue } from 'react-native-reanimated';

// o ouvido da ADA (1_ada/voz/ouvido.py) só aceita WAV de 16 kHz, mono, 16 bits
const TAXA = 16000;
const PASTA_DOS_PEDACOS = 'AudioStream'; // onde o expo-audio grava os arquivos, dentro do cache do app

// o corte nas pausas, simulado nas gravações do usuário no celular (silêncio ~0,0003-0,0005, fala ~0,011-0,033)
const SILENCIO_QUE_FECHA_S = 0.8; // a pausa que fecha um pedaço
const FALA_MINIMA_S = 0.3; // menos fala que isso é barulho (tosse, porta): o pedaço vai fora
const ESPERA_SEM_FALA_S = 10; // 10 s sem ninguém falar: o arquivo vazio vai fora e começa outro
const PEDACO_MAXIMO_S = 28; // falou 28 s sem pausa: fecha mesmo assim (o Whisper lê até 30)
const FOLGA_SOBRE_O_RUIDO = 6; // é fala o que passa de 6x o ruído de fundo
const NIVEL_MINIMO = 0.002; // e de 0,002, pra sala silenciosa demais não virar fala com qualquer sopro
const SUBIDA_DO_RUIDO_POR_S = 0.5; // no silêncio, o ruído de fundo cai na hora e sobe até 50% por segundo
// fala tem pausas entre as palavras; 4 s seguidos sem nenhuma é um fundo novo (ventilador, TV), e o ruído de fundo
// vira o mínimo desses 4 s. Simulado: fala contínua de 11,7 s fica num pedaço, e um ventilador ligando no meio corta
const SEM_SILENCIO_S = 4;

export class SemPermissao extends Error {}

type Pedaco = { fala: number; silencio: number; duracao: number; uri: string };
type RuidoDeFundo = { nivel: number | null; ultimos: number[]; semSilencio: number };

const pedacoVazio = (): Pedaco => ({ fala: 0, silencio: 0, duracao: 0, uri: '' });
const ruidoNaoMedido = (): RuidoDeFundo => ({ nivel: null, ultimos: [], semSilencio: 0 });

// o nível de um trecho do microfone (amostras int16): a raiz da média dos quadrados, de 0 a 1
function nivelDo(buffer: AudioStreamBuffer) {
  const amostras = new Int16Array(buffer.data);
  let soma = 0;
  for (const amostra of amostras) {
    soma += (amostra / 32768) ** 2;
  }
  return Math.sqrt(soma / Math.max(amostras.length, 1));
}

function apagarArquivo(uri: string) {
  if (uri && new File(uri).exists) {
    new File(uri).delete();
  }
}

// ligar() abre o microfone e já grava o primeiro pedaço; a cada pausa depois de fala, o pedaço fecha,
// vai pro aoPedaco em base64 e outro começa. nivel é o nível do microfone agora, pra animação da tela
export function useMicrofone(aoPedaco: (wavEmBase64: string) => void) {
  const nivel = useSharedValue(0);
  const pedaco = useRef<Pedaco>(pedacoVazio());
  const ruidoDeFundo = useRef<RuidoDeFundo>(ruidoNaoMedido());
  const mexendoNoArquivo = useRef<Promise<void> | null>(null); // abrindo ou fechando o arquivo do pedaço
  const querLigado = useRef(false); // o último pedido da tela: um ligar no meio desiste se virou false
  const ligando = useRef<Promise<void> | null>(null);
  const desligando = useRef<Promise<void> | null>(null);
  const ligado = useRef(false);
  const { stream } = useAudioStream({ sampleRate: TAXA, channels: 1, encoding: 'int16', onBuffer: aoOuvir });

  // uma mexida no arquivo por vez: quem pede no meio de outra espera essa mesma. Uma que falha só perde o pedaço
  // (sem arquivo aberto, o próximo trecho do microfone abre outro)
  function umaPorVez(passo: () => Promise<void>) {
    if (!mexendoNoArquivo.current) {
      mexendoNoArquivo.current = passo()
        .catch(() => {})
        .finally(() => {
          mexendoNoArquivo.current = null;
        });
    }
    return mexendoNoArquivo.current;
  }

  async function abrirPedaco() {
    const { uri } = await stream.startFileRecordingAsync({ format: 'wav' });
    pedaco.current = { ...pedacoVazio(), uri };
  }

  // fecha o arquivo, abre o próximo (com o microfone ainda ligado) e entrega o fechado em base64;
  // o fechado é apagado mesmo se der erro no meio. Sem arquivo pra fechar (o Android parou o microfone por fora),
  // o pedaço só zera, e o próximo trecho do microfone abre outro
  function fecharPedaco(vaiPraADA: boolean) {
    return umaPorVez(async () => {
      const gravado = await stream.stopFileRecordingAsync().catch(() => null);
      pedaco.current = pedacoVazio();
      if (!gravado) return;
      try {
        if (ligado.current) {
          await abrirPedaco();
        }
        if (vaiPraADA) {
          aoPedaco(await new File(gravado.uri).base64());
        }
      } finally {
        apagarArquivo(gravado.uri);
      }
    });
  }

  // fala ou silêncio, e o ruído de fundo aprendendo: no silêncio ele cai na hora e sobe devagar; depois de
  // SEM_SILENCIO_S sem nenhum silêncio, vira o mínimo desse tempo (o fundo subiu de vez)
  function ehFalaEAprende(nivelAgora: number, segundos: number) {
    const ruido = ruidoDeFundo.current;
    ruido.ultimos.push(nivelAgora);
    if (ruido.ultimos.length * segundos > SEM_SILENCIO_S) {
      ruido.ultimos.shift();
    }
    const base = ruido.nivel ?? nivelAgora;
    const ehFala = nivelAgora > Math.max(base * FOLGA_SOBRE_O_RUIDO, NIVEL_MINIMO);
    if (!ehFala) {
      ruido.nivel = Math.min(nivelAgora, base * Math.pow(1 + SUBIDA_DO_RUIDO_POR_S, segundos));
      ruido.semSilencio = 0;
    } else {
      ruido.semSilencio += segundos;
      if (ruido.semSilencio >= SEM_SILENCIO_S) {
        ruido.nivel = Math.min(...ruido.ultimos);
        ruido.semSilencio = 0;
      }
    }
    return ehFala;
  }

  function aoOuvir(buffer: AudioStreamBuffer) {
    const nivelAgora = nivelDo(buffer);
    const segundos = buffer.data.byteLength / 2 / buffer.sampleRate;
    nivel.value = nivelAgora;
    if (!ligado.current || mexendoNoArquivo.current) return;
    if (!pedaco.current.uri) {
      umaPorVez(abrirPedaco);
      return;
    }

    const atual = pedaco.current;
    atual.duracao += segundos;
    if (ehFalaEAprende(nivelAgora, segundos)) {
      atual.fala += segundos;
      atual.silencio = 0;
    } else {
      atual.silencio += segundos;
    }

    const temFala = atual.fala >= FALA_MINIMA_S;
    if (temFala && atual.silencio >= SILENCIO_QUE_FECHA_S) {
      fecharPedaco(true);
    } else if (atual.duracao >= PEDACO_MAXIMO_S) {
      fecharPedaco(temFala);
    } else if (!temFala && atual.duracao >= ESPERA_SEM_FALA_S) {
      fecharPedaco(false);
    }
  }

  // espera um desligar no meio; pede a permissão (SemPermissao se negar); confere a cada espera se a tela ainda
  // quer o microfone; e não liga num celular que não grava em 16 kHz (o ouvido recusaria tudo)
  async function abrirMicrofone() {
    await desligando.current;
    if (ligado.current) return;
    const permissao = await requestRecordingPermissionsAsync();
    if (!permissao.granted) {
      throw new SemPermissao('o app precisa da permissão do microfone');
    }
    if (!querLigado.current) return;
    const pastaDosPedacos = new Directory(Paths.cache, PASTA_DOS_PEDACOS);
    if (pastaDosPedacos.exists) {
      pastaDosPedacos.delete(); // o que sobrou de antes (o app morto no meio de um pedaço)
    }
    await stream.start();
    if (!querLigado.current) {
      stream.stop();
      return;
    }
    if (stream.sampleRate !== TAXA) {
      stream.stop();
      throw new Error(`o microfone deste celular não grava em ${TAXA} Hz (deu ${stream.sampleRate})`);
    }
    ligado.current = true;
    pedaco.current = pedacoVazio();
    ruidoDeFundo.current = ruidoNaoMedido();
    await umaPorVez(abrirPedaco);
  }

  // dois ligar() juntos (a tela abrindo e o app voltando do fundo) viram um só
  function ligar() {
    querLigado.current = true;
    if (!ligando.current) {
      ligando.current = abrirMicrofone().finally(() => {
        ligando.current = null;
      });
    }
    return ligando.current;
  }

  // o pedaço que estava gravando é jogado fora: desligar é sair da tela, o app ir pro fundo ou a vez da ADA.
  // Com um ligar no meio, ele desiste sozinho (querLigado); com uma mexida no arquivo, ela termina antes
  function desligar() {
    querLigado.current = false;
    if (!ligado.current) {
      return desligando.current ?? ligando.current?.catch(() => {}) ?? Promise.resolve();
    }
    ligado.current = false;
    nivel.value = 0;
    desligando.current = (async () => {
      await mexendoNoArquivo.current;
      stream.stop();
      apagarArquivo(pedaco.current.uri);
      pedaco.current = pedacoVazio();
    })().finally(() => {
      desligando.current = null;
    });
    return desligando.current;
  }

  // a seta (só vai pra ADA se teve fala) e a lixeira (vai fora): fecham agora o pedaço, sem esperar a pausa
  function fecharJa(vaiPraADA: boolean) {
    if (!ligado.current || !pedaco.current.uri) {
      return mexendoNoArquivo.current ?? Promise.resolve();
    }
    return fecharPedaco(vaiPraADA);
  }

  const fecharAgora = () => fecharJa(pedaco.current.fala >= FALA_MINIMA_S);
  const descartarPedaco = () => fecharJa(false);

  return { ligar, desligar, fecharAgora, descartarPedaco, nivel };
}
