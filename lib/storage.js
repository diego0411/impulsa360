import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'formularios_locales';

export const guardarFormularioLocal = async (formulario) => {
  try {
    if (!formulario || typeof formulario !== 'object') {
      throw new Error('Formulario inválido');
    }

    const existentes = await AsyncStorage.getItem(STORAGE_KEY);
    const lista = existentes ? JSON.parse(existentes) : [];

    const nuevoFormulario = {
      id: formulario.id || Date.now(),
      ...formulario,
    };

    const index = lista.findIndex(f => f.id === nuevoFormulario.id);
    if (index !== -1) {
      lista[index] = nuevoFormulario;
    } else {
      lista.push(nuevoFormulario);
    }

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  } catch (error) {
    console.error('❌ Error al guardar formulario local:', error);
    throw error;
  }
};

export const obtenerFormulariosLocales = async () => {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    const lista = data ? JSON.parse(data) : [];
    return lista.sort((a, b) => b.id - a.id);
  } catch (error) {
    console.error('❌ Error al obtener formularios locales:', error);
    return [];
  }
};

export const eliminarFormularioLocal = async (id) => {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    const lista = data ? JSON.parse(data) : [];

    const nuevaLista = lista.filter((item) => item.id !== id);

    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nuevaLista));
  } catch (error) {
    console.error('❌ Error al eliminar formulario local:', error);
    throw error;
  }
};

export const limpiarFormulariosLocales = async () => {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('❌ Error al limpiar formularios locales:', error);
    throw error;
  }
};

export const contarFormulariosLocales = async () => {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    const lista = data ? JSON.parse(data) : [];
    return lista.length;
  } catch (error) {
    console.error('❌ Error al contar formularios locales:', error);
    return 0;
  }
};
