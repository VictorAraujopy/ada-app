// O que mais de uma tela usa: a marca, o eletro (o estado da ADA, que se atualiza sozinho) e o botão de ícone.
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { type ComponentProps, useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, G, Mask, Path, Polyline, Rect } from 'react-native-svg';

import { comPrazo, estadoDaAda, info, type Info } from '@/ada';
import { cor } from '@/tema';

export type NomeDoIcone = ComponentProps<typeof Feather>['name'];

// as quatro asas da borboleta, as mesmas do assets/marca.svg (o desenho-fonte da marca e dos ícones)
const ASAS = [
  'M100 124 C88 96 58 98 68 120 C73 132 92 131 100 124 Z',
  'M100 124 C112 96 142 98 132 120 C127 132 108 131 100 124 Z',
  'M100 126 C90 130 72 144 81 153 C89 160 98 143 100 126 Z',
  'M100 126 C110 130 128 144 119 153 C111 160 102 143 100 126 Z',
];

// o A com a borboleta do vestido do RE4 no lugar da barra; com a ADA fora do ar, a borboleta apaga
export function MarcaDaAda({ tamanho, apagada = false }: { tamanho: number; apagada?: boolean }) {
  return (
    <Svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 200 200"
      accessibilityLabel={apagada ? 'ADA fora do ar' : 'ADA'}
    >
      <Defs>
        {/* a borboleta abre um vão nas pernas do A, e o corpo dela abre um vão entre as asas;
            as máscaras cobrem o desenho inteiro (userSpaceOnUse), senão a ponta afiada do A é cortada */}
        <Mask id="vao-da-borboleta" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
          <Rect width="200" height="200" fill="white" />
          {ASAS.map((asa) => (
            <Path key={asa} d={asa} fill="black" stroke="black" strokeWidth={8} strokeLinejoin="round" />
          ))}
        </Mask>
        <Mask id="corpo-da-borboleta" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="200">
          <Rect width="200" height="200" fill="white" />
          <Path d="M100 110 V146" stroke="black" strokeWidth={4} strokeLinecap="round" />
        </Mask>
      </Defs>
      <Path
        d="M52 170 L100 36 L148 170"
        fill="none"
        stroke={cor.texto}
        strokeWidth={20}
        strokeLinejoin="miter"
        mask="url(#vao-da-borboleta)"
      />
      <G fill={apagada ? cor.marcaApagada : cor.vermelho} mask="url(#corpo-da-borboleta)">
        {ASAS.map((asa) => (
          <Path key={asa} d={asa} />
        ))}
      </G>
    </Svg>
  );
}

export function Eletro({ corDoSinal, largura = 34 }: { corDoSinal: string; largura?: number }) {
  return (
    <Svg width={largura} height={largura / 2.6} viewBox="0 0 26 10">
      <Polyline
        points="0,5 7,5 9.5,1 12,9 14.5,5 26,5"
        fill="none"
        stroke={corDoSinal}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// pergunta o /info a cada 5s, só enquanto a tela está na frente (5s sem resposta = fora do ar)
export function useInfo() {
  const [atual, setAtual] = useState<Info | null>(null);
  const [foraDoAr, setForaDoAr] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let naTela = true;
      const perguntar = () =>
        comPrazo(info(), 5000)
          .then((resposta) => {
            if (!naTela) return;
            setAtual(resposta);
            setForaDoAr(false);
          })
          .catch(() => {
            if (naTela) setForaDoAr(true);
          });
      perguntar();
      const relogio = setInterval(perguntar, 5000);
      return () => {
        naTela = false;
        clearInterval(relogio);
      };
    }, []),
  );

  return { info: atual, estado: estadoDaAda(atual, foraDoAr) };
}

// a cor diz o estado, como na tela de status do RE: verde no ar, âmbar carregando ou com fila, vermelho fora do ar
function corDoEstado(estado: string) {
  if (estado === 'pronta') return cor.vivo;
  if (estado === 'fora do ar') return cor.vermelho;
  if (estado === '…') return cor.apagado;
  return cor.atencao;
}

export function EstadoDaAda({ estado, largura }: { estado: string; largura?: number }) {
  return (
    <View accessible accessibilityLabel={`ADA ${estado}`}>
      <Eletro corDoSinal={corDoEstado(estado)} largura={largura} />
    </View>
  );
}

export function BotaoIcone({
  icone,
  rotulo,
  aoTocar,
  destaque = false,
}: {
  icone: NomeDoIcone;
  rotulo: string;
  aoTocar: () => void;
  destaque?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      onPress={aoTocar}
      hitSlop={6}
      style={({ pressed }) => [estilos.botaoIcone, destaque && estilos.botaoDestaque, pressed && estilos.apertado]}
    >
      <Feather name={icone} size={destaque ? 16 : 21} color={destaque ? cor.vermelhoTexto : cor.texto} />
    </Pressable>
  );
}

const estilos = StyleSheet.create({
  botaoIcone: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  botaoDestaque: { borderWidth: 1, borderColor: cor.vermelho },
  apertado: { opacity: 0.6 },
});
