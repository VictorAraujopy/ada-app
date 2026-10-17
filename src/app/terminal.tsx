// O terminal do Mac. Abre com a digital e a senha (na primeira vez a senha é criada aqui) e trava sozinho:
// 5 min parado ou o app indo pro fundo. Um comando por vez; o quadrado vermelho é o Ctrl+C.
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';
import { router } from 'expo-router';
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { entrarNoTerminal, ErroDaAda, estadoDoTerminal, pararComando, rodarComando, sairDoTerminal } from '@/ada';
import { BotaoIcone } from '@/componentes';
import { cor, fonte } from '@/tema';

const TRAVA_PARADO = 5 * 60 * 1000; // o mesmo prazo da sessão no servidor
const MAX_SAIDA = 100_000; // de cada comando, a tela guarda só o fim
const MINIMO_SENHA = 8; // o mesmo da API (api/senha.py)

type Fase = 'travado' | 'senha' | 'aberto';
type Bloco = { id: number; cmd: string; saida: string; codigo: number | null; segundos: number | null; inicio: number };

function duracao(ms: number) {
  const segundos = Math.floor(ms / 1000);
  return segundos < 60 ? `${segundos}s` : `${Math.floor(segundos / 60)}min ${segundos % 60}s`;
}

export default function Terminal() {
  const margens = useSafeAreaInsets();
  const [fase, setFase] = useState<Fase>('travado');
  const [criandoSenha, setCriandoSenha] = useState(false);
  const [senha, setSenha] = useState('');
  const [repeticao, setRepeticao] = useState('');
  const [sessao, setSessao] = useState<string | null>(null);
  const [pasta, setPasta] = useState('~');
  const [blocos, setBlocos] = useState<Bloco[]>([]);
  const [comando, setComando] = useState('');
  const [historico, setHistorico] = useState<string[]>([]); // o mais novo primeiro; o clear limpa a tela, não isto
  const [erro, setErro] = useState('');
  const [agora, setAgora] = useState(Date.now());
  const ultimoToque = useRef(Date.now());
  const sessaoAtual = useRef<string | null>(null); // a mesma sessão, lida de dentro do relógio e do AppState
  const rolagem = useRef<ComponentRef<typeof ScrollView>>(null);

  const rodando = blocos.some((bloco) => bloco.codigo === null);
  const recentes = historico.slice(0, 3);

  const travar = useCallback(() => {
    if (sessaoAtual.current) sairDoTerminal(sessaoAtual.current).catch(() => null);
    sessaoAtual.current = null;
    setSessao(null);
    setSenha('');
    setRepeticao('');
    setFase('travado');
  }, []);

  // trava quando o app vai pro fundo e quando sai desta tela
  useEffect(() => {
    const assinatura = AppState.addEventListener('change', (estadoDoApp) => {
      if (estadoDoApp === 'background') travar();
    });
    return () => {
      assinatura.remove();
      travar();
    };
  }, [travar]);

  // 5 min sem tocar na tela: trava. O mesmo relógio anda o "rodando · 12s".
  useEffect(() => {
    if (fase !== 'aberto') return;
    const relogio = setInterval(() => {
      setAgora(Date.now());
      if (Date.now() - ultimoToque.current > TRAVA_PARADO) travar();
    }, 1000);
    return () => clearInterval(relogio);
  }, [fase, travar]);

  function tocou() {
    ultimoToque.current = Date.now();
  }

  async function liberarComDigital() {
    setErro('');
    const temSensor = await LocalAuthentication.hasHardwareAsync();
    const temDigital = await LocalAuthentication.isEnrolledAsync();
    if (!temSensor || !temDigital) {
      setErro('cadastra uma digital no celular primeiro');
      return;
    }
    const resultado = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Abrir o terminal',
      cancelLabel: 'Cancelar',
      disableDeviceFallback: true, // só a digital, sem cair pro PIN do celular
      biometricsSecurityLevel: 'strong',
    });
    if (!resultado.success) {
      if (resultado.error !== 'user_cancel') setErro('a digital não passou');
      return;
    }
    try {
      const { tem_senha } = await estadoDoTerminal();
      setCriandoSenha(!tem_senha);
      setFase('senha');
    } catch (e) {
      setErro(e instanceof ErroDaAda ? e.message : 'não consegui falar com a ADA');
    }
  }

  async function entrar() {
    setErro('');
    if (criandoSenha && senha.length < MINIMO_SENHA) {
      setErro(`a senha precisa de pelo menos ${MINIMO_SENHA} caracteres`);
      return;
    }
    if (criandoSenha && senha !== repeticao) {
      setErro('as duas não bateram');
      return;
    }
    try {
      const resposta = await entrarNoTerminal(senha);
      sessaoAtual.current = resposta.sessao;
      setSessao(resposta.sessao);
      if (blocos.length === 0) setPasta(resposta.pasta);
      tocou();
      setFase('aberto');
    } catch (e) {
      setErro(e instanceof ErroDaAda ? e.message : 'não consegui falar com a ADA');
    } finally {
      setSenha('');
      setRepeticao('');
    }
  }

  async function rodar(texto: string) {
    const cmd = texto.trim();
    if (!cmd || !sessao || rodando) return;
    tocou();
    setComando('');
    setErro('');
    // o clear limpa a tela aqui mesmo: no servidor ele só devolveria o código de controle de limpar o terminal
    if (cmd === 'clear') {
      setBlocos([]);
      return;
    }
    setHistorico((antigos) => [cmd, ...antigos.filter((antigo) => antigo !== cmd)].slice(0, 50));
    const id = Date.now();
    const atualizar = (mudar: (bloco: Bloco) => Bloco) =>
      setBlocos((todos) => todos.map((bloco) => (bloco.id === id ? mudar(bloco) : bloco)));
    setBlocos((todos) => [...todos, { id, cmd, saida: '', codigo: null, segundos: null, inicio: Date.now() }]);

    try {
      await rodarComando(sessao, cmd, pasta, (evento) => {
        if (evento.t === 'saida') {
          atualizar((bloco) => ({ ...bloco, saida: (bloco.saida + evento.d).slice(-MAX_SAIDA) }));
        } else {
          atualizar((bloco) => ({ ...bloco, codigo: evento.codigo, segundos: evento.s }));
          setPasta(evento.pasta);
        }
      });
    } catch (e) {
      const motivo = e instanceof ErroDaAda ? e.message : 'a conexão caiu; o comando pode continuar rodando no Mac';
      atualizar((bloco) => ({ ...bloco, saida: bloco.saida + (bloco.saida ? '\n' : '') + motivo }));
      if (e instanceof ErroDaAda && e.status === 401) travar();
    }
    // stream que acabou sem o "fim" (conexão caiu): o bloco para de dizer "rodando"
    atualizar((bloco) => (bloco.codigo === null ? { ...bloco, codigo: -1 } : bloco));
  }

  async function parar() {
    if (!sessao) return;
    tocou();
    await pararComando(sessao).catch((e) => setErro(e instanceof ErroDaAda ? e.message : 'não consegui parar'));
  }

  const cabecalho = (
    <View style={estilos.cabecalho}>
      <BotaoIcone icone="chevron-left" rotulo="Voltar" aoTocar={() => router.back()} />
      <View style={estilos.centroDoCabecalho}>
        <Text style={estilos.titulo}>Terminal</Text>
        {fase === 'aberto' ? <Text style={estilos.pasta}>{pasta}</Text> : null}
      </View>
      {fase === 'aberto' && rodando ? (
        <BotaoIcone icone="square" rotulo="Parar o comando (Ctrl+C)" aoTocar={parar} destaque />
      ) : (
        <View style={estilos.vaga} />
      )}
    </View>
  );

  if (fase !== 'aberto') {
    return (
      <KeyboardAvoidingView behavior="padding" style={[estilos.tela, { paddingTop: margens.top }]}>
        {cabecalho}
        <View style={estilos.centro}>
          {fase === 'travado' ? (
            <>
              <View style={estilos.cadeado}>
                <MaterialCommunityIcons name="fingerprint" size={44} color={cor.vermelhoTexto} />
              </View>
              <Text style={estilos.travadoTitulo}>Terminal travado</Text>
              <Text style={estilos.travadoDica}>Trava sozinho depois de 5 min parado.</Text>
              <Pressable
                accessibilityRole="button"
                onPress={liberarComDigital}
                style={({ pressed }) => [estilos.botao, pressed && estilos.apertado]}
              >
                <Text style={estilos.botaoTexto}>Liberar com a digital</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={estilos.travadoTitulo}>{criandoSenha ? 'Cria a senha do terminal' : 'Senha do terminal'}</Text>
              {criandoSenha ? <Text style={estilos.travadoDica}>Trocar depois, só no Mac.</Text> : null}
              <TextInput
                accessibilityLabel="Senha"
                value={senha}
                onChangeText={setSenha}
                placeholder="senha"
                placeholderTextColor={cor.apagado}
                secureTextEntry
                autoFocus
                onSubmitEditing={criandoSenha ? undefined : entrar}
                style={estilos.campoSenha}
              />
              {criandoSenha ? (
                <TextInput
                  accessibilityLabel="Senha de novo"
                  value={repeticao}
                  onChangeText={setRepeticao}
                  placeholder="de novo"
                  placeholderTextColor={cor.apagado}
                  secureTextEntry
                  onSubmitEditing={entrar}
                  style={estilos.campoSenha}
                />
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={entrar}
                disabled={!senha}
                style={({ pressed }) => [estilos.botao, !senha && estilos.desligado, pressed && estilos.apertado]}
              >
                <Text style={estilos.botaoTexto}>{criandoSenha ? 'Criar e entrar' : 'Entrar'}</Text>
              </Pressable>
            </>
          )}
          {erro ? <Text style={estilos.erro}>{erro}</Text> : null}
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[estilos.tela, { paddingTop: margens.top }]}
      onTouchStart={tocou}
    >
      {cabecalho}

      <ScrollView
        ref={rolagem}
        style={estilos.areaDasSaidas}
        contentContainerStyle={estilos.saidas}
        onContentSizeChange={() => rolagem.current?.scrollToEnd({ animated: false })}
      >
        {blocos.map((bloco) => (
          <View key={bloco.id} style={estilos.bloco}>
            <Text style={estilos.linhaDoComando}>
              <Text style={estilos.cifrao}>$ </Text>
              {bloco.cmd}
            </Text>
            {bloco.saida ? (
              <Text selectable style={estilos.saida}>
                {bloco.saida.replace(/\n$/, '')}
              </Text>
            ) : null}
            {bloco.codigo === null ? (
              <View style={estilos.rodandoLinha}>
                <View style={estilos.ponto} />
                <Text style={estilos.rodapeDoBloco}>rodando · {duracao(agora - bloco.inicio)}</Text>
              </View>
            ) : (
              <Text style={estilos.rodapeDoBloco}>
                {bloco.codigo === -1
                  ? 'interrompido'
                  : `saiu ${bloco.codigo} · ${(bloco.segundos ?? 0).toLocaleString('pt-BR')}s`}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>

      {erro ? <Text style={estilos.erroAberto}>{erro}</Text> : null}

      {recentes.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={estilos.faixaDosRecentes}
          contentContainerStyle={estilos.recentes}
        >
          {recentes.map((recente) => (
            // preenche o campo em vez de rodar: num terminal, um toque errado não tem volta
            <Pressable key={recente} accessibilityRole="button" onPress={() => setComando(recente)} style={estilos.recente}>
              <Text style={estilos.recenteTexto} numberOfLines={1}>
                {recente}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <View style={[estilos.rodape, { paddingBottom: margens.bottom + 12 }]}>
        <View style={estilos.campo}>
          <Text style={estilos.cifraoDoCampo}>$</Text>
          <TextInput
            accessibilityLabel="Comando"
            value={comando}
            onChangeText={(novo) => {
              tocou();
              setComando(novo);
            }}
            placeholder="comando"
            placeholderTextColor={cor.apagado}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="send"
            submitBehavior="submit"
            onSubmitEditing={() => rodar(comando)}
            style={estilos.entrada}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Rodar"
            onPress={() => rodar(comando)}
            disabled={!comando.trim() || rodando}
            style={({ pressed }) => [
              estilos.enviar,
              (!comando.trim() || rodando) && estilos.desligado,
              pressed && estilos.apertado,
            ]}
          >
            <Feather name="arrow-up" size={19} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
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
  centroDoCabecalho: { flex: 1, alignItems: 'center', gap: 3 },
  titulo: { fontFamily: fonte.textoForte, fontSize: 16, color: cor.texto },
  pasta: { fontFamily: fonte.codigo, fontSize: 11.5, color: cor.apagado },
  vaga: { width: 44 },
  centro: { flex: 1, paddingHorizontal: 40, paddingBottom: 80, gap: 16, alignItems: 'center', justifyContent: 'center' },
  cadeado: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 1.5,
    borderColor: cor.vermelho,
    alignItems: 'center',
    justifyContent: 'center',
  },
  travadoTitulo: { fontFamily: fonte.textoForte, fontSize: 20, color: cor.texto, textAlign: 'center' },
  travadoDica: { fontFamily: fonte.texto, fontSize: 14.5, color: cor.apagado, textAlign: 'center' },
  campoSenha: {
    alignSelf: 'stretch',
    height: 52,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: cor.linha,
    backgroundColor: cor.superficie,
    fontFamily: fonte.texto,
    fontSize: 16,
    color: cor.texto,
  },
  botao: {
    height: 50,
    paddingHorizontal: 28,
    borderRadius: 14,
    backgroundColor: cor.vermelho,
    alignItems: 'center',
    justifyContent: 'center',
  },
  botaoTexto: { fontFamily: fonte.textoForte, fontSize: 16, color: '#FFFFFF' },
  erro: { fontFamily: fonte.texto, fontSize: 14, color: cor.vermelhoTexto, textAlign: 'center' },
  // ScrollView cresce por padrão: a saída fica com o espaço todo e a faixa dos recentes cola no campo
  areaDasSaidas: { flex: 1 },
  saidas: { padding: 18, gap: 18 },
  bloco: { gap: 4 },
  linhaDoComando: { fontFamily: fonte.codigo, fontSize: 12.5, lineHeight: 19, color: cor.texto },
  cifrao: { color: cor.vermelhoTexto },
  saida: { fontFamily: fonte.codigo, fontSize: 12.5, lineHeight: 19, color: cor.textoFraco },
  rodandoLinha: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  ponto: { width: 6, height: 6, borderRadius: 3, backgroundColor: cor.vermelho },
  rodapeDoBloco: { fontFamily: fonte.texto, fontSize: 12, color: cor.apagado },
  erroAberto: { marginHorizontal: 18, marginBottom: 6, fontFamily: fonte.texto, fontSize: 14, color: cor.vermelhoTexto },
  faixaDosRecentes: { flexGrow: 0 },
  recentes: { paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  recente: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: cor.linha,
    justifyContent: 'center',
  },
  recenteTexto: { maxWidth: 220, fontFamily: fonte.codigo, fontSize: 12, color: cor.textoFraco },
  rodape: { paddingHorizontal: 12 },
  campo: {
    height: 52,
    paddingLeft: 16,
    paddingRight: 6,
    gap: 8,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: cor.linha,
    backgroundColor: cor.superficie,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cifraoDoCampo: { fontFamily: fonte.codigo, fontSize: 15, color: cor.vermelhoTexto },
  entrada: { flex: 1, height: 44, fontFamily: fonte.codigo, fontSize: 15, color: cor.texto },
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
