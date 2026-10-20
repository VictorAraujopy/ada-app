// A foto que vai pra ADA: tirar com a câmera ou escolher da galeria, e preparar pra mandar
// (no máximo 1024 px de lado, JPEG em base64). A API encolhe de novo se vier maior: isto só poupa o upload.
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

const MAX_LADO = 1024; // o mesmo teto da API (api/limite.py, MAX_LADO_DA_FOTO)

export type FotoPronta = { uri: string; base64: string };

export async function pegarFoto(origem: 'camera' | 'galeria'): Promise<FotoPronta | null> {
  if (origem === 'camera') {
    const permissao = await ImagePicker.requestCameraPermissionsAsync();
    if (!permissao.granted) {
      throw new Error('sem permissão pra usar a câmera');
    }
  }
  const abrir = origem === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
  const escolha = await abrir({ mediaTypes: ['images'], quality: 1 });
  if (escolha.canceled) return null;
  return preparar(escolha.assets[0].uri);
}

// encolhe já na leitura (foto de 50 MP nunca abre inteira na memória) e já sai em pé:
// o leitor de imagem do Android aplica a orientação da câmera
async function preparar(uri: string): Promise<FotoPronta> {
  const contexto = ImageManipulator.manipulate(uri, { maxWidth: MAX_LADO, maxHeight: MAX_LADO });
  const imagem = await contexto.renderAsync();
  const salva = await imagem.saveAsync({ format: SaveFormat.JPEG, compress: 0.9, base64: true });
  if (!salva.base64) {
    throw new Error('não consegui preparar a foto');
  }
  return { uri: salva.uri, base64: salva.base64 };
}
