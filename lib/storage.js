// storage.js
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'formularios_locales';

/**
 * Guarda un formulario localmente con un ID único.
 */
export const guardarFormularioLocal = async (formulario) => {
  try {
    const existentes = await AsyncStorage.getItem(STORAGE_KEY);
    const lista = existentes ? JSON.parse(existentes) : [];
    const nuevoFormulario = {
      id: Date.now(),
      ...formulario
    };
    lista.push(nuevoFormulario);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(lista));
  } catch (error) {
    console.error('Error al guardar en AsyncStorage:', error);
  }
};

/**
 * Obtiene todos los formularios almacenados localmente.
 */
export const obtenerFormulariosLocales = async () => {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error al obtener formularios locales:', error);
    return [];
  }
};

/**
 * Elimina un formulario local por su ID.
 */
export const eliminarFormularioLocal = async (id) => {
  try {
    const data = await AsyncStorage.getItem(STORAGE_KEY);
    const lista = data ? JSON.parse(data) : [];
    const filtrados = lista.filter((item) => item.id !== id);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filtrados));
  } catch (error) {
    console.error('Error al eliminar formulario local:', error);
  }
};

/**
 * Limpia todos los formularios almacenados localmente.
 */
export const limpiarFormulariosLocales = async () => {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.error('Error al limpiar formularios locales:', error);
  }
};
