// A tela de voz: o assistente abre numa conversa nova, o botão de voz de um chat continua aquele (?conversa=<id>).
// Escuta sozinha, junta os pedaços transcritos; "enviar"/"apagar" (falados, ou a seta e a lixeira) mandam ou limpam.
// Sem texto de erro (a onda vermelha avisa) e com a tela do celular acesa enquanto ela está aberta.
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type { Voice } from 'expo-speech';
import { type ComponentRef, useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  adaNaoAtendeAgora,
  apagarConversa,
  comPrazo,
  conversar,
  criarConversa,
  ErroDaAda,
  type EventoChat,
  ouvir,
} from '@/ada';
import { BotaoIcone, LARGURA_DOS_BOTOES, MarcaDaAda, useInfo } from '@/componentes';
import { criarFala, escolherVoz } from '@/fala';
import { Markdown } from '@/markdown';
import { SemPermissao, useMicrofone } from '@/microfone';
import { type Fase, OndaDaVoz } from '@/onda';
import { cor, fonte } from '@/tema';

// um pedaço leva 4-7 s no Mac; o servidor espera até 30 s pela vez dele, e passou disso o pedaço se perde
const PRAZO_DO_OUVIDO_MS = 45_000;
// a ADA leva até ~90 s antes do primeiro evento; 3 min sem nenhum é a conexão que morreu calada (tailnet, Mac dormindo)
const PRAZO_SEM_NOTICIA_MS = 180_000;
const MANTER_ACESA = 'tela-de-voz'; // a marca do keep-awake desta tela

// o /chat não tem prazo (o fetch do Android espera pra sempre): sem nenhum evento por PRAZO_SEM_NOTICIA_MS, desiste
// com um erro que não é da ADA, que conta como "caiu no meio"; o que chegar depois disso é ignorado
async function conversarComVigia(conversa: string, mensagem: string, aoEvento: (evento: EventoChat) => void) {
  let ultimaNoticia = Date.now();
  let desistiu = false;
  let vigia: ReturnType<typeof setInterval> | undefined;
  const semNoticia = new Promise<never>((_, desistir) => {
    vigia = setInterval(() => {
      if (Date.now() - ultimaNoticia > PRAZO_SEM_NOTICIA_MS) {
        desistiu = true;
        desistir(new Error('a resposta parou de chegar'));
      }
    }, 5000);
  });
  const resposta = conversar(conversa, mensagem, null, (evento) => {
    ultimaNoticia = Date.now();
    if (!desistiu) aoEvento(evento);
  });
  try {
    await Promise.race([resposta, semNoticia]);
  } finally {
    clearInterval(vigia);
  }
}

export default function VozTela() {
  const margens = useSafeAreaInsets();
  const parametros = useLocalSearchParams<{ conversa?: string }>();
  const { estado } = useInfo();
  const [fase, setFase] = useState<Fase>('ouvindo');
  const [textoDele, setTextoDele] = useState('');
  const [resposta, setResposta] = useState('');
  const [transcrevendo, setTranscrevendo] = useState(0); // pedaços esperando o ouvido
  const [microfoneQuebrado, setMicrofoneQuebrado] = useState(false);

  const juntado = useRef(''); // o que ele já disse desde o último enviar/apagar
  // tudo que mexe no texto passa por esta fila, na ordem em que aconteceu: os pedaços, a lixeira e a seta
  const fila = useRef(Promise.resolve());
  const conversa = useRef<string | null>(parametros.conversa ?? null); // sem chat de origem, nasce no 1º enviar
  const vezDaADA = useRef(false); // do enviar até a última frase dela: o que ele disser nesse meio não entra
  const permissaoNegada = useRef(false); // negou o microfone: não pergunta de novo até ele voltar pra tela
  const adaNaoAtende = useRef(false); // carregando ou ocupada com outra conversa: o microfone fica fechado
  const voz = useRef<Voice | null>(null);
  const fala = useRef<ReturnType<typeof criarFala> | null>(null);
  const naTela = useRef(false);
  const rolagem = useRef<ComponentRef<typeof ScrollView>>(null);

  const microfone = useMicrofone(aoPedaco);

  function mudarTexto(novo: string) {
    juntado.current = novo;
    setTextoDele(novo);
  }

  // um passo que falha não trava a fila: os seguintes continuam rodando
  function naFila(passo: () => void | Promise<void>) {
    fila.current = fila.current.then(passo).catch(() => {});
  }

  // a vez volta pra ele (a onda mostra ouvindo, âmbar se ela não atende), e o microfone abre só com a tela na
  // frente, o app aberto (no fundo o Android não deixa gravar), a ADA atendendo e a permissão não negada
  async function escutar() {
    if (!naTela.current || vezDaADA.current) return;
    setFase('ouvindo');
    if (AppState.currentState !== 'active' || adaNaoAtende.current || permissaoNegada.current) return;
    try {
      await microfone.ligar();
      setMicrofoneQuebrado(false);
    } catch (e) {
      permissaoNegada.current = e instanceof SemPermissao;
      setMicrofoneQuebrado(true);
    }
  }

  function aoPedaco(wavEmBase64: string) {
    setTranscrevendo((pedacos) => pedacos + 1);
    naFila(async () => {
      try {
        await entenderPedaco(wavEmBase64);
      } finally {
        setTranscrevendo((pedacos) => pedacos - 1);
      }
    });
  }

  // na vez da ADA o pedaço nem vai pro Mac (a CPU está gerando a resposta). O ouvido fora do ar, travado ou um
  // áudio recusado: o pedaço se perde (e a onda já fica vermelha se a API caiu)
  async function entenderPedaco(wavEmBase64: string) {
    if (!naTela.current || vezDaADA.current) return;
    const ouvido = await comPrazo(ouvir(wavEmBase64), PRAZO_DO_OUVIDO_MS).catch(() => null);
    if (!ouvido || vezDaADA.current) return;
    if (ouvido.comando === 'apagar') {
      mudarTexto('');
      return;
    }
    const tudo = [juntado.current, ouvido.texto].filter((parte) => parte.length > 0).join(' ');
    if (ouvido.comando === 'enviar' && tudo.length > 0) {
      // sem await: a fila não fica presa nos 40-90 s da resposta (a vez da ADA já barra os pedaços seguintes)
      mandar(tudo);
      return;
    }
    if (ouvido.texto.length > 0) setResposta(''); // ele começou a próxima: a resposta anterior sai da tela
    mudarTexto(tudo);
  }

  // a lixeira: o pedaço gravando vai fora, e o texto some depois dos pedaços que já estavam indo pro ouvido
  async function tocarNaLixeira() {
    await microfone.descartarPedaco();
    naFila(() => mudarTexto(''));
  }

  // a seta: fecha agora o pedaço gravando e manda tudo depois que ele e os anteriores voltarem do ouvido
  async function tocarNaSeta() {
    await microfone.fecharAgora();
    naFila(() => {
      if (juntado.current) mandar(juntado.current);
    });
  }

  // a vez da ADA: o microfone fecha (ela não escuta a própria voz) e só reabre depois da última frase falada
  async function mandar(mensagem: string) {
    if (!naTela.current || vezDaADA.current) return;
    vezDaADA.current = true;
    await microfone.desligar().catch(() => {});
    juntado.current = ''; // o que foi mandado não entra na próxima mensagem (só fica na tela até ela responder)
    setTextoDele(mensagem);
    setResposta('');
    setFase('pensando');
    let respondeu = false;
    let deuErro = false;
    try {
      if (!conversa.current) {
        const nova = (await criarConversa(mensagem)).id;
        // saiu enquanto a conversa nascia: ela ficaria vazia na lista, e a fala não chegou na ADA
        if (!naTela.current) {
          await apagarConversa(nova).catch(() => null);
          return;
        }
        conversa.current = nova;
      }
      const falaDestaVez = voz.current ? criarFala(voz.current, depoisDeFalar) : null;
      fala.current = falaDestaVez;
      await conversarComVigia(conversa.current, mensagem, (evento) => {
        // saiu da tela durante a resposta: ela termina e grava no servidor, e aqui ninguém mais escuta
        if (!naTela.current) return;
        if (evento.t === 'resp') {
          if (evento.d.trim()) respondeu = true;
          setFase('falando');
          setResposta((atual) => atual + evento.d);
          falaDestaVez?.receber(evento.d);
        } else if (evento.t === 'erro') {
          deuErro = true;
        }
      });
      if (!naTela.current) return;
      if (deuErro || !respondeu) {
        devolverMensagem(mensagem); // o worker só grava resposta que terminou com texto: nada entrou no histórico
      } else if (falaDestaVez) {
        falaDestaVez.terminar();
      } else {
        depoisDeFalar();
      }
    } catch (e) {
      if (e instanceof ErroDaAda) {
        devolverMensagem(mensagem); // recusou antes de começar (ocupada, carregando, fora do ar): nada foi gravado
      } else {
        fala.current?.parar(); // caiu no meio: o servidor termina e grava; devolver duplicaria a pergunta
        depoisDeFalar();
      }
    }
  }

  // o que ele disse volta pra tela, pra mandar de novo
  function devolverMensagem(mensagem: string) {
    fala.current?.parar();
    fala.current = null;
    vezDaADA.current = false;
    mudarTexto(mensagem);
    escutar();
  }

  // o "ocupada" que o /info viu durante a resposta era dela mesma, que acabou: o microfone reabre na hora (ocupada
  // com outra conversa, a próxima consulta do /info fecha de novo)
  function depoisDeFalar() {
    fala.current = null;
    vezDaADA.current = false;
    adaNaoAtende.current = false;
    mudarTexto('');
    escutar();
  }

  // entrar na tela: tela do celular acesa, a voz escolhida e o microfone aberto (pergunta a permissão de novo)
  const aoEntrarNaTela = useEffectEvent(() => {
    naTela.current = true;
    permissaoNegada.current = false;
    activateKeepAwakeAsync(MANTER_ACESA).catch(() => {});
    escolherVoz()
      .then((escolhida) => {
        voz.current = escolhida;
      })
      .catch(() => {});
    escutar();
  });

  // sair (voltar, outra tela, outro assistente por cima): o microfone fecha, a ADA se cala e a tela pode apagar.
  // A vez da ADA acaba aqui: voltando pra esta tela, o microfone reabre
  const aoSairDaTela = useEffectEvent(() => {
    naTela.current = false;
    deactivateKeepAwake(MANTER_ACESA).catch(() => {});
    microfone.desligar().catch(() => {});
    fala.current?.parar();
    fala.current = null;
    vezDaADA.current = false;
  });

  // o app foi pro fundo (bloqueou a tela, trocou de app, o pedido de permissão na frente): o microfone fecha.
  // Voltou: reabre do zero, a não ser na vez da ADA (reabre depois da última frase) ou com a permissão negada
  const aoMudarOApp = useEffectEvent((estadoDoApp: AppStateStatus) => {
    if (estadoDoApp === 'background') {
      microfone.desligar().catch(() => {});
    } else if (estadoDoApp === 'active' && !vezDaADA.current && !permissaoNegada.current) {
      microfone
        .desligar()
        .then(escutar)
        .catch(() => {});
    }
  });

  // carregando ou ocupada (o sinal âmbar do app), a ADA não atende: o microfone fecha, e abre sozinho quando ela
  // fica pronta. Na vez dela nesta tela ele já está fechado, e só reabre depois da última frase
  const aoMudarOEstadoDaADA = useEffectEvent((estadoAgora: string) => {
    adaNaoAtende.current = adaNaoAtendeAgora(estadoAgora);
    if (adaNaoAtende.current) {
      microfone.desligar().catch(() => {});
    } else if (!vezDaADA.current && !permissaoNegada.current) {
      escutar();
    }
  });
  useEffect(() => {
    aoMudarOEstadoDaADA(estado);
  }, [estado]);

  useFocusEffect(
    useCallback(() => {
      aoEntrarNaTela();
      const assinatura = AppState.addEventListener('change', (estadoDoApp) => aoMudarOApp(estadoDoApp));
      return () => {
        assinatura.remove();
        aoSairDaTela();
      };
    }, []),
  );

  // o texto cresce (a fala dele, a resposta dela) e a tela desce junto; no quadro seguinte, porque na hora do
  // evento o Android ainda não aplicou a altura nova (o mesmo cuidado da conversa)
  function descerComOTexto() {
    requestAnimationFrame(() => rolagem.current?.scrollToEnd({ animated: true }));
  }

  function voltar() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  }

  return (
    <View style={[estilos.tela, { paddingTop: margens.top, paddingBottom: margens.bottom + 12 }]}>
      <View style={estilos.cabecalho}>
        <BotaoIcone icone="chevron-left" rotulo="Voltar" moldura largura={LARGURA_DOS_BOTOES} aoTocar={voltar} />
        <MarcaDaAda tamanho={36} apagada={estado === 'fora do ar'} />
      </View>

      {/* escutando com ela carregando ou ocupada, a onda fica como quando ela pensa: âmbar, igual o sinal do app */}
      <OndaDaVoz
        fase={fase === 'ouvindo' && adaNaoAtendeAgora(estado) ? 'pensando' : fase}
        nivel={microfone.nivel}
        vermelha={estado === 'fora do ar' || microfoneQuebrado}
      />

      <ScrollView
        ref={rolagem}
        style={estilos.rolagem}
        contentContainerStyle={estilos.falas}
        onContentSizeChange={descerComOTexto}
      >
        <Text style={estilos.textoDele}>
          {textoDele}
          {transcrevendo > 0 ? <Text style={estilos.reticencias}>{textoDele ? ' …' : '…'}</Text> : null}
        </Text>
        {resposta.trim() ? <Markdown texto={resposta.trim()} /> : null}
      </ScrollView>

      {fase === 'ouvindo' && !adaNaoAtendeAgora(estado) ? (
        <View style={estilos.botoes}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Apagar o que eu disse"
            onPress={tocarNaLixeira}
            hitSlop={6}
            style={({ pressed }) => [estilos.lixeira, pressed && estilos.apertado]}
          >
            <Feather name="trash-2" size={20} color={cor.apagado} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enviar"
            onPress={tocarNaSeta}
            style={({ pressed }) => [estilos.seta, pressed && estilos.apertado]}
          >
            <Feather name="arrow-up" size={19} color="#FFFFFF" />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.fundo, paddingHorizontal: 16, gap: 16 },
  cabecalho: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 8 },
  rolagem: { flex: 1 },
  falas: { gap: 16, paddingBottom: 24 },
  textoDele: { fontFamily: fonte.textoMedio, fontSize: 22, lineHeight: 30, color: cor.texto },
  reticencias: { color: cor.apagado },
  // as mesmas medidas do botão da foto e do enviar da conversa
  botoes: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6 },
  lixeira: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  seta: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: cor.vermelho,
    alignItems: 'center',
    justifyContent: 'center',
  },
  apertado: { opacity: 0.7 },
});
