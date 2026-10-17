// A cara do app (a A2 do canvas): preto, e o vermelho só em ação e estado.

export const cor = {
  fundo: '#0B0B0C',
  superficie: '#151517', // campo de texto, bloco de código, ficha
  balao: '#1C1C1F', // a mensagem de quem escreve
  linha: '#26262A',
  texto: '#F2EFEA',
  textoFraco: '#C9C5BF',
  apagado: '#8E8A85', // horário, "pensou 3,8s", placeholder
  marcaApagada: '#56565C', // a borboleta quando a ADA está fora do ar
  vermelho: '#D7192A', // botão, e o eletro com a ADA fora do ar (o DANGER do RE)
  vivo: '#3DCB6C', // o eletro com a ADA no ar (o FINE do RE)
  atencao: '#E8A33D', // o eletro com a ADA carregando ou com fila (o CAUTION do RE)
  vermelhoTexto: '#F0464F', // vermelho que dá pra ler em letra pequena no preto
};

// os nomes são os que os pacotes @expo-google-fonts exportam (carregados no _layout)
export const fonte = {
  marca: 'BarlowCondensed_700Bold', // só o "ADA"
  texto: 'Barlow_400Regular',
  italico: 'Barlow_400Regular_Italic',
  textoMedio: 'Barlow_500Medium',
  textoForte: 'Barlow_600SemiBold',
  codigo: 'JetBrainsMono_400Regular',
};
