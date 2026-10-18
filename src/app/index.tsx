// A lista de conversas: o sinal da ADA no topo, as conversas por dia e o botão de nova.
// Segurar uma conversa apaga (com confirmação). Sem conexão, mostra o erro com o tentar de novo.
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { apagarConversa, comPrazo, type Conversa, ErroDaAda, listarConversas } from '@/ada';
import { BotaoIcone, MarcaDaAda, useInfo } from '@/componentes';
import { SinalDaAda } from '@/sinal';
import { cor, fonte } from '@/tema';

const UM_DIA = 24 * 60 * 60 * 1000;
// a largura de "00:00" na lista (números de largura fixa); o terminal no topo tem a mesma, pra ficar em cima da hora
const LARGURA_DA_HORA = 28;

// Hoje / Ontem / Esta semana / Antes, pela última atividade da conversa
function secaoDe(atualizada: number) {
  const inicioDeHoje = new Date().setHours(0, 0, 0, 0);
  const quando = atualizada * 1000;
  if (quando >= inicioDeHoje) return 'Hoje';
  if (quando >= inicioDeHoje - UM_DIA) return 'Ontem';
  if (quando >= inicioDeHoje - 6 * UM_DIA) return 'Esta semana';
  return 'Antes';
}

function quando(atualizada: number) {
  const data = new Date(atualizada * 1000);
  const secao = secaoDe(atualizada);
  if (secao === 'Hoje' || secao === 'Ontem') {
    return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }
  if (secao === 'Esta semana') {
    return data.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
  }
  return data.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function agruparPorDia(conversas: Conversa[]) {
  const secoes: { title: string; data: Conversa[] }[] = [];
  for (const conversa of conversas) {
    const titulo = secaoDe(conversa.atualizada);
    const ultima = secoes[secoes.length - 1];
    if (ultima && ultima.title === titulo) {
      ultima.data.push(conversa);
    } else {
      secoes.push({ title: titulo, data: [conversa] });
    }
  }
  return secoes;
}

// a linha entre conversas do mesmo dia: a cor da borda do sinal, na largura da lista
function Divisoria() {
  return <View style={estilos.divisoria} />;
}

export default function Conversas() {
  const margens = useSafeAreaInsets();
  const { info, estado } = useInfo();
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState('');

  const recarregar = useCallback(async () => {
    setCarregando(true);
    try {
      setConversas(await comPrazo(listarConversas(), 8000));
      setErro('');
    } catch (e) {
      setErro(e instanceof ErroDaAda ? e.message : 'não consegui carregar as conversas');
    } finally {
      setCarregando(false);
    }
  }, []);

  // abrir o app ou voltar da conversa = testa a conexão e atualiza a lista (a ordem muda e a prévia também)
  useFocusEffect(
    useCallback(() => {
      recarregar();
    }, [recarregar]),
  );

  function confirmarApagar(conversa: Conversa) {
    Alert.alert('Apagar a conversa?', conversa.titulo, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Apagar',
        style: 'destructive',
        onPress: async () => {
          await apagarConversa(conversa.id).catch(() => null);
          recarregar();
        },
      },
    ]);
  }

  return (
    <View style={[estilos.tela, { paddingTop: margens.top }]}>
      <View style={estilos.cabecalho}>
        <SinalDaAda estado={estado} />
        {info?.terminal ? (
          <BotaoIcone
            icone="terminal"
            rotulo="Terminal do Mac"
            moldura
            largura={LARGURA_DA_HORA}
            aoTocar={() => router.push('/terminal')}
          />
        ) : null}
      </View>

      {erro ? (
        <View style={estilos.semConexao}>
          <MarcaDaAda tamanho={120} apagada />
          <Pressable
            accessibilityRole="button"
            onPress={recarregar}
            disabled={carregando}
            style={({ pressed }) => [estilos.tentar, (pressed || carregando) && estilos.apertado]}
          >
            <Text style={estilos.tentarTexto}>{carregando ? 'Tentando…' : 'Tentar de novo'}</Text>
          </Pressable>
        </View>
      ) : (
        <SectionList
          sections={agruparPorDia(conversas)}
          keyExtractor={(conversa) => conversa.id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={estilos.lista}
          refreshControl={
            <RefreshControl
              refreshing={carregando}
              onRefresh={recarregar}
              colors={[cor.vermelho]}
              progressBackgroundColor={cor.superficie}
            />
          }
          renderSectionHeader={({ section }) => <Text style={estilos.secao}>{section.title}</Text>}
          ItemSeparatorComponent={Divisoria}
          renderItem={({ item: conversa }) => (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/conversa/${conversa.id}`)}
              onLongPress={() => confirmarApagar(conversa)}
              style={({ pressed }) => [estilos.item, pressed && estilos.itemApertado]}
            >
              <View style={estilos.itemLinha}>
                <Text style={estilos.itemTitulo} numberOfLines={1}>
                  {conversa.titulo}
                </Text>
                <Text style={estilos.itemQuando}>{quando(conversa.atualizada)}</Text>
              </View>
              {conversa.previa ? (
                <Text style={estilos.itemPrevia} numberOfLines={1}>
                  {conversa.previa}
                </Text>
              ) : null}
            </Pressable>
          )}
          ListEmptyComponent={carregando ? undefined : <Text style={estilos.vazio}>Nenhuma conversa ainda.</Text>}
        />
      )}

      {erro ? null : (
        <View style={[estilos.rodape, { paddingBottom: margens.bottom + 16 }]}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/conversa/nova')}
            style={({ pressed }) => [estilos.nova, pressed && estilos.apertado]}
          >
            <Feather name="plus" size={18} color="#FFFFFF" />
            <Text style={estilos.novaTexto}>Nova conversa</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const estilos = StyleSheet.create({
  tela: { flex: 1, backgroundColor: cor.fundo },
  cabecalho: {
    paddingTop: 14,
    paddingBottom: 12,
    paddingHorizontal: 20,
    gap: 12,
    flexDirection: 'row',
    alignItems: 'center',
  },
  semConexao: {
    flex: 1,
    paddingHorizontal: 40,
    paddingBottom: 80,
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tentar: {
    height: 50,
    marginTop: 8,
    paddingHorizontal: 28,
    borderRadius: 14,
    backgroundColor: cor.vermelho,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tentarTexto: { fontFamily: fonte.textoForte, fontSize: 16, color: '#FFFFFF' },
  // 12 da lista + 8 do item = 20, a mesma margem do sinal
  lista: { paddingHorizontal: 12, paddingBottom: 12 },
  secao: {
    paddingHorizontal: 8,
    paddingTop: 12,
    paddingBottom: 6,
    fontFamily: fonte.textoMedio,
    fontSize: 12.5,
    color: cor.apagado,
  },
  item: {
    minHeight: 60,
    paddingHorizontal: 8,
    borderRadius: 12,
    gap: 2,
    justifyContent: 'center',
  },
  itemApertado: { backgroundColor: cor.balao },
  itemLinha: { gap: 12, flexDirection: 'row', alignItems: 'baseline' },
  itemTitulo: { flex: 1, fontFamily: fonte.textoMedio, fontSize: 15.5, color: cor.texto },
  itemPrevia: { fontFamily: fonte.texto, fontSize: 13, color: cor.apagado },
  itemQuando: {
    minWidth: LARGURA_DA_HORA,
    textAlign: 'right',
    fontFamily: fonte.texto,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    color: cor.apagado,
  },
  divisoria: { height: 1, marginHorizontal: 8, backgroundColor: cor.linha },
  vazio: { padding: 20, textAlign: 'center', fontFamily: fonte.texto, fontSize: 14, color: cor.apagado },
  rodape: { paddingHorizontal: 20, paddingTop: 12 },
  nova: {
    height: 52,
    borderRadius: 14,
    backgroundColor: cor.vermelho,
    gap: 9,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  novaTexto: { fontFamily: fonte.textoForte, fontSize: 16, color: '#FFFFFF' },
  apertado: { opacity: 0.7 },
});
