// Uma conversa: as mensagens do banco, a resposta da ADA chegando ao vivo e o campo de mandar (texto e foto).
// "nova" é a conversa que ainda não existe: ela nasce na primeira mensagem (o título é a própria mensagem).
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  abrirConversa,
  conversar,
  criarConversa,
  enderecoDaFoto,
  ErroDaAda,
  type Mensagem,
  type Tool,
} from '@/ada';
import { BotaoIcone, MarcaDaAda, useInfo } from '@/componentes';
import { type FotoPronta, pegarFoto } from '@/foto';
import { Markdown } from '@/markdown';
import { ALTURA_DO_SINAL, SinalDaAda } from '@/sinal';
import { cor, fonte } from '@/tema';

const MAX_TEXTO = 20_000; // o mesmo teto da API (api/limite.py)
const LARGURA_DOS_BOTOES = 28; // a caixa estreita do terminal da tela inicial

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
  const [foto, setFoto] = useState<FotoPronta | null>(null); // a foto escolhida, esperando o enviar
  const [erro, setErro] = useState('');
  const lista = useRef<ComponentRef<typeof ScrollView>>(null);
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
  const podeMandar = (texto.trim().length > 0 || foto !== null) && !ocupada && adaAtende;

  function escolherFoto() {
    Alert.alert('Mandar uma foto', undefined, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Galeria', onPress: () => anexar('galeria') },
      { text: 'Câmera', onPress: () => anexar('camera') },
    ]);
  }

  async function anexar(origem: 'camera' | 'galeria') {
    try {
      const pronta = await pegarFoto(origem);
      if (pronta) setFoto(pronta);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'não consegui pegar a foto');
    }
  }

  // a mensagem que acabou de sair (n -1) mostra a foto pelo arquivo do celular; as do banco vêm da API
  function fotoDa(mensagem: Mensagem) {
    if (!mensagem.foto) return null;
    return mensagem.n === -1 ? mensagem.foto : enderecoDaFoto(id, mensagem.foto);
  }

  async function enviar() {
    const msg = texto.trim();
    const fotoEnviada = foto;
    if ((!msg && !fotoEnviada) || ocupada) return;
    setTexto('');
    setFoto(null);
    setErro('');
    let conversa = id;
    try {
      if (conversa === 'nova') {
        conversa = (await criarConversa(msg || 'foto')).id;
        setId(conversa);
      }
      // aparece na hora; a versão do banco chega no recarregar do fim
      const naHora: Mensagem = { n: -1, role: 'user', content: msg, meta: null, foto: fotoEnviada?.uri ?? null };
      setMensagens((atuais) => [...atuais, naHora]);
      setAoVivo({ think: '', tools: [], resp: '' });
      pertoDoFim.current = true;
      await conversar(conversa, msg, fotoEnviada?.base64 ?? null, (evento) => {
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
        // a API recusou antes de gravar (ocupada, carregando, fora do ar, foto inválida): a mensagem volta pro campo
        setErro(e.message);
        setTexto(msg);
        setFoto(fotoEnviada);
        setMensagens((atuais) => atuais.filter((m) => m.n !== -1));
      } else {
        setErro('a conexão caiu no meio; a ADA termina e grava a resposta');
      }
    } finally {
      setAoVivo(null);
      await recarregar(conversa); // a verdade é o banco: a resposta que o worker gravou, com o meta
    }
  }

  // só desce sozinho se quem lê já estava no fim (quem subiu pra reler não é puxado de volta);
  // no quadro seguinte: na hora do evento o Android ainda não aplicou a altura nova e rolaria só até o fim antigo
  function descerSeEstavaNoFim() {
    if (!pertoDoFim.current) return;
    requestAnimationFrame(() => lista.current?.scrollToEnd({ animated: false }));
  }

  function aoRolar(evento: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = evento.nativeEvent;
    pertoDoFim.current = contentSize.height - contentOffset.y - layoutMeasurement.height < 80;
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={[estilos.tela, { paddingTop: margens.top }]}>
      <View style={estilos.cabecalho}>
        <BotaoIcone
          icone="chevron-left"
          rotulo="Conversas"
          moldura
          largura={LARGURA_DOS_BOTOES}
          aoTocar={() => router.back()}
        />
        <View style={estilos.logo}>
          <MarcaDaAda tamanho={36} apagada={estado === 'fora do ar'} />
        </View>
        <SinalDaAda estado={estado} />
        <BotaoIcone
          icone="edit"
          rotulo="Nova conversa"
          moldura
          largura={LARGURA_DOS_BOTOES}
          aoTocar={() => router.replace('/conversa/nova')}
        />
      </View>

      {/* ScrollView e não FlatList: uma conversa tem poucas dezenas de mensagens, e a virtualização da
          FlatList deixava a última resposta em branco quando ela trocava a versão ao vivo pela do banco */}
      <ScrollView
        ref={lista}
        contentContainerStyle={estilos.mensagens}
        // só o dedo decide se quem lê saiu do fim: a rolagem do próprio app e o conteúdo crescendo não contam
        onScrollEndDrag={aoRolar}
        onMomentumScrollEnd={aoRolar}
        // desce quando o conteúdo cresce e quando a própria lista muda de altura (abriu agora, teclado)
        onContentSizeChange={descerSeEstavaNoFim}
        onLayout={descerSeEstavaNoFim}
      >
        {mensagens.map((mensagem, i) =>
          mensagem.role === 'user' ? (
            <Balao key={`${mensagem.n}-${i}`} texto={mensagem.content} foto={fotoDa(mensagem)} />
          ) : (
            <RespostaDaAda
              key={`${mensagem.n}-${i}`}
              texto={mensagem.content}
              think={mensagem.meta?.think ?? ''}
              tools={mensagem.meta?.tools ?? []}
              pensouS={mensagem.meta?.pensou_s ?? null}
              pensando={false}
            />
          ),
        )}
        {aoVivo ? (
          <RespostaDaAda
            texto={aoVivo.resp}
            think={aoVivo.think}
            tools={aoVivo.tools}
            pensouS={null}
            pensando={!aoVivo.resp}
          />
        ) : gerando ? (
          <Text style={estilos.aviso}>A ADA ainda tá respondendo…</Text>
        ) : null}
      </ScrollView>

      {erro ? <Text style={estilos.erro}>{erro}</Text> : null}

      <View style={[estilos.rodape, { paddingBottom: margens.bottom + 12 }]}>
        {foto ? (
          <View style={estilos.anexo}>
            <Image source={{ uri: foto.uri }} style={estilos.anexoFoto} accessibilityLabel="Foto escolhida" />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tirar a foto"
              onPress={() => setFoto(null)}
              hitSlop={8}
              style={estilos.anexoTirar}
            >
              <Feather name="x" size={13} color={cor.texto} />
            </Pressable>
          </View>
        ) : null}
        <View style={estilos.campo}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mandar foto"
            onPress={escolherFoto}
            disabled={ocupada}
            hitSlop={6}
            style={({ pressed }) => [estilos.botaoFoto, ocupada && estilos.desligado, pressed && estilos.apertado]}
          >
            <Feather name="image" size={20} color={cor.apagado} />
          </Pressable>
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

function Balao({ texto, foto }: { texto: string; foto: string | null }) {
  return (
    <View style={estilos.balao}>
      {foto ? <Image source={{ uri: foto }} style={estilos.balaoFoto} accessibilityLabel="Foto mandada" /> : null}
      {texto ? (
        <Text selectable style={estilos.balaoTexto}>
          {texto}
        </Text>
      ) : null}
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
  // o mesmo topo da tela inicial (14 em cima, margem 20): o sinal não pula de lugar ao abrir a conversa
  cabecalho: {
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 20,
    gap: 12,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: cor.linha,
  },
  logo: {
    width: ALTURA_DO_SINAL,
    height: ALTURA_DO_SINAL,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: cor.linha,
    backgroundColor: cor.superficie,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mensagens: { padding: 20, gap: 22 },
  balao: {
    alignSelf: 'flex-end',
    maxWidth: '80%',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderBottomRightRadius: 6,
    backgroundColor: cor.balao,
    gap: 10,
  },
  balaoFoto: { width: 220, height: 220, borderRadius: 12, backgroundColor: cor.superficie },
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
  rodape: { paddingHorizontal: 20, paddingTop: 8 },
  anexo: { alignSelf: 'flex-start', marginBottom: 10, marginLeft: 6 },
  anexoFoto: { width: 64, height: 64, borderRadius: 10, borderWidth: 1, borderColor: cor.linha },
  anexoTirar: {
    position: 'absolute',
    top: -7,
    right: -7,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: cor.linha,
    backgroundColor: cor.balao,
    alignItems: 'center',
    justifyContent: 'center',
  },
  campo: {
    minHeight: 52,
    paddingLeft: 6,
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
  botaoFoto: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
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
