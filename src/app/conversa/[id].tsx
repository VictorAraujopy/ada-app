// Uma conversa: as mensagens do banco, a resposta da ADA chegando ao vivo e o campo de mandar.
// "nova" é a conversa que ainda não existe: ela nasce na primeira mensagem (o título é a própria mensagem).
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { abrirConversa, conversar, criarConversa, ErroDaAda, type Mensagem, type Tool } from '@/ada';
import { BotaoIcone, EstadoDaAda, useInfo } from '@/componentes';
import { Markdown } from '@/markdown';
import { cor, fonte } from '@/tema';

const MAX_TEXTO = 20_000; // o mesmo teto da API (api/limite.py)

type AoVivo = { think: string; tools: Tool[]; resp: string };

export default function ConversaTela() {
  const margens = useSafeAreaInsets();
  const parametros = useLocalSearchParams<{ id: string }>();
  const { estado } = useInfo();
  const [id, setId] = useState(parametros.id); // "nova" vira o id de verdade na primeira mensagem
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [aoVivo, setAoVivo] = useState<AoVivo | null>(null);
  const [gerando, setGerando] = useState(false); // a ADA ainda responde no servidor (o app caiu e voltou)
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState('');
  const lista = useRef<FlatList<Mensagem>>(null);
  const pertoDoFim = useRef(true);

  const recarregar = useCallback(async (conversa: string) => {
    if (conversa === 'nova') return;
    try {
      const aberta = await abrirConversa(conversa);
      setMensagens(aberta.mensagens);
      setGerando(aberta.gerando);
    } catch (e) {
      setErro(e instanceof ErroDaAda ? e.message : 'não consegui abrir a conversa');
    }
  }, []);

  useEffect(() => {
    recarregar(parametros.id);
  }, [parametros.id, recarregar]);

  // voltou com a ADA ainda respondendo: pergunta de 2 em 2s até a resposta entrar no banco
  useEffect(() => {
    if (!gerando || aoVivo) return;
    const relogio = setInterval(() => recarregar(id), 2000);
    return () => clearInterval(relogio);
  }, [gerando, aoVivo, id, recarregar]);

  const ocupada = aoVivo !== null || gerando;
  const adaAtende = estado === 'pronta' || estado.endsWith('na frente');
  const podeMandar = texto.trim().length > 0 && !ocupada && adaAtende;

  async function enviar() {
    const msg = texto.trim();
    if (!msg || ocupada) return;
    setTexto('');
    setErro('');
    let conversa = id;
    try {
      if (conversa === 'nova') {
        conversa = (await criarConversa(msg)).id;
        setId(conversa);
      }
      // aparece na hora; a versão do banco chega no recarregar do fim
      setMensagens((atuais) => [...atuais, { n: -1, role: 'user', content: msg, meta: null }]);
      setAoVivo({ think: '', tools: [], resp: '' });
      pertoDoFim.current = true;
      await conversar(conversa, msg, (evento) => {
        if (evento.t === 'think') {
          setAoVivo((atual) => atual && { ...atual, think: atual.think + evento.d });
        } else if (evento.t === 'resp') {
          setAoVivo((atual) => atual && { ...atual, resp: atual.resp + evento.d });
        } else if (evento.t === 'tool') {
          setAoVivo((atual) => atual && { ...atual, tools: [...atual.tools, { nome: evento.nome, res: evento.res }] });
        } else if (evento.t === 'erro') {
          setErro(evento.d);
        }
      });
    } catch (e) {
      if (e instanceof ErroDaAda) {
        // a API recusou antes de gravar (ocupada, carregando, fora do ar): a mensagem volta pro campo
        setErro(e.message);
        setTexto(msg);
        setMensagens((atuais) => atuais.filter((m) => m.n !== -1));
      } else {
        setErro('a conexão caiu no meio; a ADA termina e grava a resposta');
      }
    } finally {
      setAoVivo(null);
      await recarregar(conversa); // a verdade é o banco: a resposta que o worker gravou, com o meta
    }
  }

  function aoRolar(evento: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = evento.nativeEvent;
    pertoDoFim.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={[estilos.tela, { paddingTop: margens.top }]}>
      <View style={estilos.cabecalho}>
        <BotaoIcone icone="chevron-left" rotulo="Conversas" aoTocar={() => router.back()} />
        <View style={estilos.centroDoCabecalho}>
          <Text style={estilos.marca}>ADA</Text>
          <EstadoDaAda estado={estado} />
        </View>
        <BotaoIcone icone="edit" rotulo="Nova conversa" aoTocar={() => router.replace('/conversa/nova')} />
      </View>

      <FlatList
        ref={lista}
        data={mensagens}
        keyExtractor={(mensagem, i) => `${mensagem.n}-${i}`}
        contentContainerStyle={estilos.mensagens}
        onScroll={aoRolar}
        scrollEventThrottle={100}
        // só desce sozinho se quem lê já estava no fim (quem subiu pra reler não é puxado de volta)
        onContentSizeChange={() => {
          if (pertoDoFim.current) lista.current?.scrollToEnd({ animated: false });
        }}
        renderItem={({ item: mensagem }) =>
          mensagem.role === 'user' ? (
            <Balao texto={mensagem.content} />
          ) : (
            <RespostaDaAda
              texto={mensagem.content}
              think={mensagem.meta?.think ?? ''}
              tools={mensagem.meta?.tools ?? []}
              pensouS={mensagem.meta?.pensou_s ?? null}
              pensando={false}
            />
          )
        }
        ListFooterComponent={
          aoVivo ? (
            <RespostaDaAda
              texto={aoVivo.resp}
              think={aoVivo.think}
              tools={aoVivo.tools}
              pensouS={null}
              pensando={!aoVivo.resp}
            />
          ) : gerando ? (
            <Text style={estilos.aviso}>A ADA ainda tá respondendo…</Text>
          ) : undefined
        }
      />

      {erro ? <Text style={estilos.erro}>{erro}</Text> : null}

      <View style={[estilos.rodape, { paddingBottom: margens.bottom + 12 }]}>
        <View style={estilos.campo}>
          <TextInput
            accessibilityLabel="Mensagem"
            value={texto}
            onChangeText={setTexto}
            placeholder="Mensagem pra ADA"
            placeholderTextColor={cor.apagado}
            multiline
            maxLength={MAX_TEXTO}
            style={estilos.entrada}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Enviar"
            onPress={enviar}
            disabled={!podeMandar}
            style={({ pressed }) => [estilos.enviar, !podeMandar && estilos.desligado, pressed && estilos.apertado]}
          >
            <Feather name="arrow-up" size={19} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Balao({ texto }: { texto: string }) {
  return (
    <View style={estilos.balao}>
      <Text selectable style={estilos.balaoTexto}>
        {texto}
      </Text>
    </View>
  );
}

function RespostaDaAda({
  texto,
  think,
  tools,
  pensouS,
  pensando,
}: {
  texto: string;
  think: string;
  tools: Tool[];
  pensouS: number | null;
  pensando: boolean;
}) {
  const [abriuOThink, setAbriuOThink] = useState(false);
  const rotulo = pensando ? 'Pensando…' : pensouS !== null ? `Pensou ${pensouS.toLocaleString('pt-BR')}s` : 'Pensou';

  return (
    <View style={estilos.resposta}>
      {think || pensando ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: abriuOThink }}
          onPress={() => setAbriuOThink(!abriuOThink)}
          hitSlop={8}
          style={estilos.pensou}
        >
          <View style={estilos.ponto} />
          <Text style={estilos.pensouTexto}>{rotulo}</Text>
          <Feather name={abriuOThink ? 'chevron-down' : 'chevron-right'} size={13} color={cor.apagado} />
        </Pressable>
      ) : null}
      {abriuOThink && think ? (
        <Text selectable style={estilos.think}>
          {think.trim()}
        </Text>
      ) : null}
      {tools.map((tool, i) => (
        <View key={i} style={estilos.tool}>
          <Feather name="tool" size={12} color={cor.vermelho} />
          <Text style={estilos.toolTexto} numberOfLines={1}>
            {tool.nome} · {tool.res}
          </Text>
        </View>
      ))}
      {texto ? <Markdown texto={texto} /> : null}
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.fundo },
  cabecalho: {
    height: 60,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: cor.linha,
  },
  centroDoCabecalho: { alignItems: 'center', gap: 3 },
  marca: { fontFamily: fonte.marca, fontSize: 21, letterSpacing: 4.2, color: cor.texto },
  mensagens: { padding: 20, gap: 22 },
  balao: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderBottomRightRadius: 6,
    backgroundColor: cor.balao,
  },
  balaoTexto: { fontFamily: fonte.texto, fontSize: 16, lineHeight: 23, color: cor.texto },
  resposta: { gap: 10 },
  pensou: { alignSelf: 'flex-start', height: 30, gap: 7, flexDirection: 'row', alignItems: 'center' },
  ponto: { width: 6, height: 6, borderRadius: 3, backgroundColor: cor.vermelho },
  pensouTexto: { fontFamily: fonte.texto, fontSize: 13.5, color: cor.apagado },
  think: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: cor.superficie,
    fontFamily: fonte.texto,
    fontSize: 14,
    lineHeight: 21,
    color: cor.apagado,
  },
  tool: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    height: 28,
    paddingHorizontal: 11,
    gap: 7,
    borderWidth: 1,
    borderColor: '#2E2A2B',
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toolTexto: { flexShrink: 1, fontFamily: fonte.texto, fontSize: 13, color: cor.textoFraco },
  aviso: { fontFamily: fonte.italico, fontSize: 14, color: cor.apagado },
  erro: { marginHorizontal: 20, marginBottom: 6, fontFamily: fonte.texto, fontSize: 14, color: cor.vermelhoTexto },
  rodape: { paddingHorizontal: 12, paddingTop: 8 },
  campo: {
    minHeight: 52,
    paddingLeft: 18,
    paddingRight: 6,
    paddingVertical: 6,
    gap: 8,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: cor.linha,
    backgroundColor: cor.superficie,
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  entrada: {
    flex: 1,
    minHeight: 40,
    maxHeight: 140,
    paddingVertical: 9,
    fontFamily: fonte.texto,
    fontSize: 16,
    color: cor.texto,
  },
  enviar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: cor.vermelho,
    alignItems: 'center',
    justifyContent: 'center',
  },
  desligado: { opacity: 0.4 },
  apertado: { opacity: 0.7 },
});
