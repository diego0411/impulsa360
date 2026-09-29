import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { colors, fontSizes, radius, spacing } from '../styles/theme';
import { withTimeout } from '../lib/asyncTimeout';
import { registrarErrorFoto } from '../lib/photoDiagnostics';

const PERMISSION_TIMEOUT_MS = 10000;
const CAMERA_READY_TIMEOUT_MS = 10000;
const CAPTURE_TIMEOUT_MS = 25000;
const FILE_CLEANUP_TIMEOUT_MS = 10000;

const parsePictureSize = (value) => {
  const match = /^(\d+)x(\d+)$/i.exec(String(value || '').trim());
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { value, width, height, maxDimension: Math.max(width, height), pixels: width * height };
};

const seleccionarPictureSize = (sizes = []) => {
  const disponibles = sizes
    .map(parsePictureSize)
    .filter((size) => size && size.pixels <= 12000000);
  const preferidos = disponibles
    .filter((size) => size.maxDimension >= 1280 && size.maxDimension <= 1920)
    .sort((a, b) => b.maxDimension - a.maxDimension || b.pixels - a.pixels);
  if (preferidos.length) return preferidos[0].value;

  return disponibles.sort((a, b) => a.pixels - b.pixels)[0]?.value || null;
};

export default function CameraEvidencia({ visible, label, onCancel, onUse }) {
  const cameraRef = useRef(null);
  const capturandoRef = useRef(false);
  const capturaOperacionRef = useRef(null);
  const consultandoTamanosRef = useRef(false);
  const procesandoRef = useRef(false);
  const mountedRef = useRef(true);
  const sessionRef = useRef(0);
  const permisoSolicitadoRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [pictureSize, setPictureSize] = useState(null);
  const [fotoCapturada, setFotoCapturada] = useState(null);
  const [capturando, setCapturando] = useState(false);
  const [capturaNativaPendiente, setCapturaNativaPendiente] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [error, setError] = useState('');

  const reportarError = async (stage, cameraError, fallback) => {
    const code = await registrarErrorFoto(stage, cameraError);
    return `${fallback} (${code})`;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
    };
  }, []);

  useEffect(() => {
    sessionRef.current += 1;
    permisoSolicitadoRef.current = false;
    if (!visible) return;
    setCameraReady(false);
    setPictureSize(null);
    setFotoCapturada(null);
    setCapturando(false);
    setCapturaNativaPendiente(Boolean(capturaOperacionRef.current));
    consultandoTamanosRef.current = false;
    procesandoRef.current = false;
    setProcesando(false);
    setError('');
  }, [visible]);

  useEffect(() => {
    if (!visible || permission) return undefined;
    const session = sessionRef.current;
    const timer = globalThis.setTimeout(() => {
      const timeoutError = new Error('La lectura del permiso de cámara excedió el tiempo permitido.');
      timeoutError.name = 'TimeoutError';
      reportarError('permission', timeoutError, 'La cámara no respondió.').then((message) => {
        if (mountedRef.current && sessionRef.current === session) setError(message);
      });
    }, PERMISSION_TIMEOUT_MS);
    return () => globalThis.clearTimeout(timer);
  }, [permission, visible]);

  useEffect(() => {
    if (!visible || !permission?.granted || cameraReady || fotoCapturada) return undefined;
    const session = sessionRef.current;
    const timer = globalThis.setTimeout(() => {
      const timeoutError = new Error('La cámara no informó que está lista dentro del tiempo permitido.');
      timeoutError.name = 'TimeoutError';
      reportarError('camera_ready', timeoutError, 'La cámara tardó demasiado en iniciar.').then((message) => {
        if (mountedRef.current && sessionRef.current === session && !cameraReady) setError(message);
      });
    }, CAMERA_READY_TIMEOUT_MS);
    return () => globalThis.clearTimeout(timer);
  }, [cameraReady, fotoCapturada, permission?.granted, visible]);

  const solicitarPermiso = async () => {
    const session = sessionRef.current;
    setError('');
    try {
      await withTimeout(
        requestPermission(),
        PERMISSION_TIMEOUT_MS,
        'La solicitud de permiso de cámara excedió el tiempo permitido.'
      );
    } catch (permissionError) {
      const message = await reportarError('permission', permissionError, 'No se pudo solicitar permiso para usar la cámara.');
      if (mountedRef.current && sessionRef.current === session) setError(message);
    }
  };

  useEffect(() => {
    if (visible && permission && !permission.granted && permission.canAskAgain && !permisoSolicitadoRef.current) {
      permisoSolicitadoRef.current = true;
      const session = sessionRef.current;
      withTimeout(
        requestPermission(),
        PERMISSION_TIMEOUT_MS,
        'La solicitud de permiso de cámara excedió el tiempo permitido.'
      ).catch(async (permissionError) => {
        const message = await reportarError('permission', permissionError, 'No se pudo solicitar permiso para usar la cámara.');
        if (mountedRef.current && sessionRef.current === session) setError(message);
      });
    }
  }, [permission, requestPermission, visible]);

  const cargarTamanos = async () => {
    if ((pictureSize && cameraReady) || consultandoTamanosRef.current || procesandoRef.current) return;
    const session = sessionRef.current;
    consultandoTamanosRef.current = true;
    if (mountedRef.current) {
      setCameraReady(false);
      setPictureSize(null);
      setError('');
    }
    try {
      const sizes = await withTimeout(
        cameraRef.current?.getAvailablePictureSizesAsync(),
        CAMERA_READY_TIMEOUT_MS,
        'La cámara tardó demasiado en informar sus resoluciones.'
      );
      const seleccion = seleccionarPictureSize(Array.isArray(sizes) ? sizes : []);
      if (!seleccion) {
        throw new Error('La cámara no informó una resolución segura de 12 MP o menos.');
      }
      if (!mountedRef.current || sessionRef.current !== session) return;
      setPictureSize(seleccion);
      setCameraReady(true);
    } catch (cameraError) {
      if (!mountedRef.current || sessionRef.current !== session) return;
      const message = await reportarError('camera_ready', cameraError, 'No se pudo preparar la cámara.');
      if (!mountedRef.current || sessionRef.current !== session) return;
      setError(message);
      setCameraReady(false);
    } finally {
      consultandoTamanosRef.current = false;
    }
  };

  const tomarFoto = async () => {
    if (!cameraReady || !pictureSize || capturandoRef.current || capturaOperacionRef.current || !cameraRef.current) return;
    capturandoRef.current = true;
    setCapturando(true);
    const session = sessionRef.current;
    const operacion = { invalidada: false, session };
    const promesaNativa = Promise.resolve().then(() => cameraRef.current?.takePictureAsync({
      quality: 0.5,
      base64: false,
      exif: false,
      skipProcessing: false,
    }));
    capturaOperacionRef.current = operacion;
    setCapturaNativaPendiente(true);
    promesaNativa
      .then(async (fotoTardia) => {
        if (fotoTardia?.uri && (operacion.invalidada || !mountedRef.current || sessionRef.current !== session)) {
          await withTimeout(
            FileSystem.deleteAsync(fotoTardia.uri, { idempotent: true }),
            FILE_CLEANUP_TIMEOUT_MS,
            'La limpieza de la captura tardía excedió el tiempo permitido.'
          ).catch(() => {});
        }
      })
      .catch(() => {})
      .finally(() => {
        if (capturaOperacionRef.current === operacion) capturaOperacionRef.current = null;
        capturandoRef.current = false;
        if (mountedRef.current && sessionRef.current === session) {
          setCapturando(false);
          setCapturaNativaPendiente(false);
        }
      });
    try {
      const foto = await withTimeout(
        promesaNativa,
        CAPTURE_TIMEOUT_MS,
        'La captura de la foto excedió el tiempo permitido.'
      );
      if (!foto?.uri) throw new Error('La cámara no devolvió una foto válida.');
      if (!mountedRef.current || sessionRef.current !== session) {
        await FileSystem.deleteAsync(foto.uri, { idempotent: true }).catch(() => {});
        return;
      }
      setFotoCapturada(foto);
    } catch (cameraError) {
      operacion.invalidada = true;
      if (mountedRef.current && sessionRef.current === session) {
        setCapturando(false);
        const message = await reportarError('capture', cameraError, 'No se pudo tomar la foto.');
        if (mountedRef.current && sessionRef.current === session) {
          const operacionSigueActiva = capturaOperacionRef.current === operacion;
          Alert.alert(
            'Error de cámara',
            operacionSigueActiva ? `${message}\nCierra la cámara y vuelve a intentarlo.` : message,
            operacionSigueActiva
              ? [{ text: 'Cerrar', onPress: cancelar }]
              : [
                { text: 'Cerrar', style: 'cancel', onPress: cancelar },
                { text: 'Reintentar', onPress: tomarFoto },
              ]
          );
        }
      }
    }
  };

  const usarFoto = () => {
    if (!fotoCapturada?.uri || procesandoRef.current) return;
    procesandoRef.current = true;
    if (mountedRef.current) setProcesando(true);
    onUse(fotoCapturada.uri);
  };

  const limpiarCapturaTemporal = async () => {
    if (fotoCapturada?.uri) {
      await withTimeout(
        FileSystem.deleteAsync(fotoCapturada.uri, { idempotent: true }),
        FILE_CLEANUP_TIMEOUT_MS,
        'La limpieza de la foto temporal excedió el tiempo permitido.'
      ).catch(() => {});
    }
  };

  const repetir = async () => {
    if (procesandoRef.current) return;
    procesandoRef.current = true;
    if (mountedRef.current) setProcesando(true);
    await limpiarCapturaTemporal();
    if (!mountedRef.current) return;
    setFotoCapturada(null);
    setCameraReady(false);
    setPictureSize(null);
    setError('');
    procesandoRef.current = false;
    setProcesando(false);
  };

  const cancelar = async () => {
    if (procesandoRef.current) return;
    if (capturaOperacionRef.current) capturaOperacionRef.current.invalidada = true;
    procesandoRef.current = true;
    if (mountedRef.current) setProcesando(true);
    await limpiarCapturaTemporal();
    if (!mountedRef.current) return;
    onCancel();
  };

  if (!visible) return null;

  return (
    <Modal visible animationType="slide" onRequestClose={cancelar}>
      <View style={styles.container}>
        <Text style={styles.title}>{label || 'Evidencia'}</Text>
        {!permission ? (
          <View style={styles.center}>
            {!error ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.error}>{error}</Text>}
            {!!error && (
              <TouchableOpacity style={styles.primaryButton} onPress={solicitarPermiso}>
                <Text style={styles.primaryText}>Reintentar</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.secondaryButton} onPress={cancelar} disabled={procesando}>
              <Text style={styles.secondaryText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.message}>Se necesita permiso de cámara para registrar la evidencia.</Text>
            {permission.canAskAgain && (
              <TouchableOpacity style={styles.primaryButton} onPress={solicitarPermiso}>
                <Text style={styles.primaryText}>Permitir cámara</Text>
              </TouchableOpacity>
            )}
            {!!error && <Text style={styles.error}>{error}</Text>}
            <TouchableOpacity style={styles.secondaryButton} onPress={cancelar} disabled={procesando}>
              <Text style={styles.secondaryText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        ) : fotoCapturada ? (
          <View style={styles.content}>
            <Image source={{ uri: fotoCapturada.uri }} style={styles.preview} resizeMode="contain" resizeMethod="resize" />
            <View style={styles.actions}>
              <TouchableOpacity style={[styles.primaryButton, procesando && styles.disabled]} onPress={usarFoto} disabled={procesando}>
                {procesando ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Usar foto</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={[styles.secondaryButton, procesando && styles.disabled]} onPress={repetir} disabled={procesando}>
                <Text style={styles.secondaryText}>Repetir</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={styles.content}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
              mode="picture"
              pictureSize={pictureSize || undefined}
              onCameraReady={cargarTamanos}
              onMountError={async (event) => {
                const message = await reportarError('camera_ready', event, 'No se pudo iniciar la cámara.');
                if (mountedRef.current) setError(message);
              }}
            />
            {!!error && <Text style={styles.error}>{error}</Text>}
            {!!error && (
              <TouchableOpacity style={styles.retryButton} onPress={cargarTamanos} disabled={consultandoTamanosRef.current}>
                <Text style={styles.secondaryText}>Reintentar</Text>
              </TouchableOpacity>
            )}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.primaryButton, (!cameraReady || capturando || capturaNativaPendiente) && styles.disabled]}
                onPress={tomarFoto}
                disabled={!cameraReady || capturando || capturaNativaPendiente}
              >
                {capturando
                  ? <ActivityIndicator color="#FFFFFF" />
                  : <Text style={styles.primaryText}>{capturaNativaPendiente ? 'Finalizando cámara...' : 'Tomar foto'}</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryButton} onPress={cancelar}>
                <Text style={styles.secondaryText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#05080D', paddingTop: spacing.xl, paddingHorizontal: spacing.md },
  content: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  title: { color: '#FFFFFF', fontSize: fontSizes.large, fontWeight: '700', marginBottom: spacing.md, textAlign: 'center' },
  message: { color: '#FFFFFF', fontSize: fontSizes.medium, textAlign: 'center' },
  camera: { flex: 1, borderRadius: radius.base, overflow: 'hidden' },
  preview: { flex: 1, width: '100%' },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md },
  primaryButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.base, paddingHorizontal: spacing.md },
  primaryText: { color: '#FFFFFF', fontSize: fontSizes.medium, fontWeight: '700' },
  secondaryButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF', borderRadius: radius.base, paddingHorizontal: spacing.md },
  secondaryText: { color: '#FFFFFF', fontSize: fontSizes.medium, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  error: { color: '#FFB4AB', fontSize: fontSizes.small, paddingTop: spacing.sm, textAlign: 'center' },
  retryButton: { alignSelf: 'center', marginTop: spacing.sm, minHeight: 42, justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF', borderRadius: radius.base, paddingHorizontal: spacing.lg },
});
