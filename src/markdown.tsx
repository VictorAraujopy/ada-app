// O markdown que a ADA escreve, no mínimo que o chat precisa: bloco de código (com copiar), título e lista,
// e dentro da linha **negrito**, *itálico* e `código`.
import { Feather } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { cor, fonte } from '@/tema';

type Bloco = { tipo: 'codigo'; lingua: string; texto: string } | { tipo: 'texto'; texto: string };

// o que está entre ``` é código; um bloco que ainda está chegando (sem o ``` de fechar) já aparece como código
function separarBlocos(markdown: string): Bloco[] {
  const blocos: Bloco[] = [];
  markdown.split('```').forEach((parte, i) => {
    const dentroDeCodigo = i % 2 === 1;
    if (!dentroDeCodigo) {
      if (parte.trim()) blocos.push({ tipo: 'texto', texto: parte.trim() });
      return;
    }
    const quebra = parte.indexOf('\n');
    const lingua = quebra === -1 ? '' : parte.slice(0, quebra).trim();
    const codigo = quebra === -1 ? parte : parte.slice(quebra + 1);
    blocos.push({ tipo: 'codigo', lingua, texto: codigo.replace(/\n$/, '') });
  });
  return blocos;
}

export function Markdown({ texto }: { texto: string }) {
  return (
    <View style={estilos.markdown}>
      {separarBlocos(texto).map((bloco, i) =>
        bloco.tipo === 'codigo' ? (
          <BlocoDeCodigo key={i} lingua={bloco.lingua} texto={bloco.texto} />
        ) : (
          <BlocoDeTexto key={i} texto={bloco.texto} />
        ),
      )}
    </View>
  );
}

function BlocoDeTexto({ texto }: { texto: string }) {
  return (
    <>
      {texto.split('\n').map((linha, i) => {
        const titulo = linha.match(/^#{1,6}\s+(.*)/);
        const item = linha.match(/^\s*([-*]|\d+\.)\s+(.*)/);
        if (titulo) {
          return (
            <Text key={i} style={estilos.titulo}>
              <Trechos texto={titulo[1]} />
            </Text>
          );
        }
        if (item) {
          const marcador = /\d/.test(item[1]) ? item[1] : '•';
          return (
            <View key={i} style={estilos.item}>
              <Text style={estilos.marcador}>{marcador}</Text>
              <Text style={[estilos.paragrafo, estilos.textoDoItem]}>
                <Trechos texto={item[2]} />
              </Text>
            </View>
          );
        }
        if (!linha.trim()) {
          return <View key={i} style={estilos.linhaVazia} />;
        }
        return (
          <Text key={i} selectable style={estilos.paragrafo}>
            <Trechos texto={linha} />
          </Text>
        );
      })}
    </>
  );
}

// **negrito**, *itálico* e `código` dentro de uma linha
function Trechos({ texto }: { texto: string }) {
  const pedacos = texto.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)/);
  return (
    <>
      {pedacos.map((pedaco, i) => {
        if (pedaco.length > 4 && pedaco.startsWith('**') && pedaco.endsWith('**')) {
          return (
            <Text key={i} style={estilos.negrito}>
              {pedaco.slice(2, -2)}
            </Text>
          );
        }
        if (pedaco.length > 2 && pedaco.startsWith('`') && pedaco.endsWith('`')) {
          return (
            <Text key={i} style={estilos.codigoNaLinha}>
              {pedaco.slice(1, -1)}
            </Text>
          );
        }
        if (pedaco.length > 2 && pedaco.startsWith('*') && pedaco.endsWith('*')) {
          return (
            <Text key={i} style={estilos.italico}>
              {pedaco.slice(1, -1)}
            </Text>
          );
        }
        return pedaco;
      })}
    </>
  );
}

function BlocoDeCodigo({ lingua, texto }: { lingua: string; texto: string }) {
  const [copiou, setCopiou] = useState(false);

  async function copiar() {
    await Clipboard.setStringAsync(texto);
    setCopiou(true);
    setTimeout(() => setCopiou(false), 1500);
  }

  return (
    <View style={estilos.codigo}>
      <View style={estilos.codigoTopo}>
        <Text style={estilos.codigoLingua}>{lingua || 'código'}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Copiar código" onPress={copiar} hitSlop={8}>
          <Feather name={copiou ? 'check' : 'copy'} size={15} color={copiou ? cor.vermelhoTexto : cor.apagado} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={estilos.codigoRolagem}>
        <Text selectable style={estilos.codigoTexto}>
          {texto}
        </Text>
      </ScrollView>
    </View>
  );
}

const estilos = StyleSheet.create({
  markdown: { gap: 10 },
  paragrafo: { fontFamily: fonte.texto, fontSize: 16, lineHeight: 25, color: cor.texto },
  titulo: { fontFamily: fonte.textoForte, fontSize: 17, lineHeight: 25, color: cor.texto, marginTop: 4 },
  item: { flexDirection: 'row', gap: 8, paddingLeft: 2 },
  marcador: { fontFamily: fonte.texto, fontSize: 16, lineHeight: 25, color: cor.vermelhoTexto, minWidth: 14 },
  textoDoItem: { flex: 1 },
  linhaVazia: { height: 4 },
  negrito: { fontFamily: fonte.textoForte, color: '#FFFFFF' },
  italico: { fontFamily: fonte.italico },
  codigoNaLinha: { fontFamily: fonte.codigo, fontSize: 14, color: cor.textoFraco, backgroundColor: cor.superficie },
  codigo: {
    backgroundColor: cor.superficie,
    borderWidth: 1,
    borderColor: cor.linha,
    borderRadius: 10,
    overflow: 'hidden',
  },
  codigoTopo: {
    height: 34,
    paddingLeft: 14,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: cor.linha,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  codigoLingua: { fontFamily: fonte.texto, fontSize: 12.5, color: cor.apagado },
  codigoRolagem: { padding: 14 },
  codigoTexto: { fontFamily: fonte.codigo, fontSize: 12.5, lineHeight: 20, color: cor.textoFraco },
});
