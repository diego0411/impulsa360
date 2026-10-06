import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { colors, fontSizes, radius, spacing } from '../styles/theme';
import { withTimeout } from '../lib/asyncTimeout';
import { registrarErrorFoto, registrarHitoCamara } from '../lib/photoDiagnostics';

const PERMISSION_TIMEOUT_MS = 10000;
const CAMERA_READY_TIMEOUT_MS = 10000;
const CAPTURE_TIMEOUT_MS = 25000;
const FILE_CLEANUP_TIMEOUT_MS = 10000;

export default function CameraEvidencia({ visible, label, onCancel, onUse }) {
  const cameraRef = useRef(null);
  const capturandoRef = useRef(false);
  const capturaOperacionRef = useRef(null);
  const procesandoRef = useRef(false);
  const mountedRef = useRef(true);
  const sessionRef = useRef(0);
  const cameraInstanceRef = useRef(0);
  const inicioAutomaticoRef = useRef(false);
  const permisoSolicitadoRef = useRef(false);
  const permisoReportadoRef = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();
  const [modalShown, setModalShown] = useState(false);
  const [cameraInstance, setCameraInstance] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
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
      cameraInstanceRef.current += 1;
    };
  }, []);

  useEffect(() => {
    sessionRef.current += 1;
    cameraInstanceRef.current += 1;
    permisoSolicitadoRef.current = false;
    permisoReportadoRef.current = false;
    inicioAutomaticoRef.current = false;
    cameraRef.current = null;
    setModalShown(false);
    setCameraInstance(null);
    if (!visible) return;
    setCameraReady(false);
    setFotoCapturada(null);
    setCapturando(false);
    setCapturaNativaPendiente(Boolean(capturaOperacionRef.current));
    procesandoRef.current = false;
    setProcesando(false);
    setError('');
  }, [visible]);

  useEffect(() => {
    if (!visible || !modalShown || !permission?.granted || permisoReportadoRef.current) return;
    permisoReportadoRef.current = true;
    registrarHitoCamara('FOTO-CAMERA-PERMISSION-GRANTED');
  }, [modalShown, permission?.granted, visible]);

  useEffect(() => {
    if (
      !visible
      || !modalShown
      || !permission?.granted
      || fotoCapturada
      || error
      || cameraInstance !== null
      || inicioAutomaticoRef.current
    ) return;
    inicioAutomaticoRef.current = true;
    const instance = cameraInstanceRef.current + 1;
    cameraInstanceRef.current = instance;
    setCameraReady(false);
    setCameraInstance(instance);
    registrarHitoCamara('FOTO-CAMERA-MOUNTED');
  }, [cameraInstance, error, fotoCapturada, modalShown, permission?.granted, visible]);

  useEffect(() => {
    if (!visible || !modalShown || permission) return undefined;
    const session = sessionRef.current;
    const timer = globalThis.setTimeout(() => {
      const timeoutError = new Error('La lectura del permiso de cámara excedió el tiempo permitido.');
      timeoutError.name = 'TimeoutError';
      reportarError('permission', timeoutError, 'La cámara no respondió.').then((message) => {
        if (mountedRef.current && sessionRef.current === session) setError(message);
      });
    }, PERMISSION_TIMEOUT_MS);
    return () => globalThis.clearTimeout(timer);
  }, [modalShown, permission, visible]);

  useEffect(() => {
    if (
      !visible
      || !modalShown
      || !permission?.granted
      || cameraReady
      || fotoCapturada
      || cameraInstance === null
    ) return undefined;
    const session = sessionRef.current;
    const instance = cameraInstance;
    const timer = globalThis.setTimeout(() => {
      if (!mountedRef.current || sessionRef.current !== session || cameraInstanceRef.current !== instance) return;
      const timeoutError = new Error('La cámara no informó que está lista dentro del tiempo permitido.');
      timeoutError.name = 'TimeoutError';
      cameraInstanceRef.current += 1;
      cameraRef.current = null;
      setCameraInstance(null);
      setCameraReady(false);
      setError('La cámara tardó demasiado en iniciar.');
      reportarError('camera_ready', timeoutError, 'La cámara tardó demasiado en iniciar.').then((message) => {
        if (mountedRef.current && sessionRef.current === session && cameraInstanceRef.current === instance + 1) setError(message);
      });
    }, CAMERA_READY_TIMEOUT_MS);
    return () => globalThis.clearTimeout(timer);
  }, [cameraInstance, cameraReady, fotoCapturada, modalShown, permission?.granted, visible]);

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
    if (visible && modalShown && permission && !permission.granted && permission.canAskAgain && !permisoSolicitadoRef.current) {
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
  }, [modalShown, permission, requestPermission, visible]);

  const manejarCamaraLista = (instance) => {
    if (
      instance !== cameraInstanceRef.current
      || cameraInstance !== instance
      || procesandoRef.current
      || cameraReady
    ) return;
    setCameraReady(true);
    registrarHitoCamara('FOTO-CAMERA-READY');
  };

  const reintentarCamara = () => {
    const instance = cameraInstanceRef.current + 1;
    cameraInstanceRef.current = instance;
    cameraRef.current = null;
    setCameraReady(false);
    setError('');
    setCameraInstance(instance);
    registrarHitoCamara('FOTO-CAMERA-MOUNTED');
  };

  const manejarErrorMontaje = async (instance, event) => {
    if (instance !== cameraInstanceRef.current || cameraInstance !== instance) return;
    const session = sessionRef.current;
    cameraInstanceRef.current += 1;
    cameraRef.current = null;
    setCameraInstance(null);
    setCameraReady(false);
    setError('No se pudo iniciar la cámara.');
    const message = await reportarError('camera_ready', event, 'No se pudo iniciar la cámara.');
    if (mountedRef.current && sessionRef.current === session && cameraInstanceRef.current === instance + 1) {
      setError(message);
    }
  };

  const tomarFoto = async () => {
    if (!cameraReady || capturandoRef.current || capturaOperacionRef.current || !cameraRef.current) return;
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
      cameraInstanceRef.current += 1;
      cameraRef.current = null;
      setCameraInstance(null);
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
    const instance = cameraInstanceRef.current + 1;
    cameraInstanceRef.current = instance;
    cameraRef.current = null;
    setCameraReady(false);
    setError('');
    setCameraInstance(instance);
    registrarHitoCamara('FOTO-CAMERA-MOUNTED');
    procesandoRef.current = false;
    setProcesando(false);
  };

  const cancelar = async () => {
    if (procesandoRef.current) return;
    if (capturaOperacionRef.current) capturaOperacionRef.current.invalidada = true;
    cameraInstanceRef.current += 1;
    cameraRef.current = null;
    setCameraInstance(null);
    setModalShown(false);
    procesandoRef.current = true;
    if (mountedRef.current) setProcesando(true);
    await limpiarCapturaTemporal();
    if (!mountedRef.current) return;
    onCancel();
  };

  if (!visible) return null;

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={cancelar}
      onShow={() => {
        if (!mountedRef.current || !visible) return;
        setModalShown(true);
        registrarHitoCamara('FOTO-CAMERA-MODAL-OPEN');
      }}
    >
      <View style={styles.container}>
        <Text style={styles.title}>{label || 'Evidencia'}</Text>
        {!modalShown ? (
          <View style={styles.center}>
            <ActivityIndicator color="#FFFFFF" />
            <Text style={styles.message}>Iniciando cámara...</Text>
            <TouchableOpacity style={styles.secondaryButton} onPress={cancelar} disabled={procesando}>
              <Text style={styles.secondaryText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        ) : !permission ? (
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
        ) : cameraInstance === null ? (
          <View style={styles.center}>
            {!error ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.error}>{error}</Text>}
            <Text style={styles.message}>{error ? 'La cámara no pudo iniciarse.' : 'Iniciando cámara...'}</Text>
            {!!error && (
              <TouchableOpacity style={styles.primaryButton} onPress={reintentarCamara} disabled={procesando}>
                <Text style={styles.primaryText}>Reintentar</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.secondaryButton} onPress={cancelar} disabled={procesando}>
              <Text style={styles.secondaryText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.content}>
            <CameraView
              ref={cameraRef}
              style={styles.camera}
              facing="back"
              mode="picture"
              onCameraReady={() => manejarCamaraLista(cameraInstance)}
              onMountError={(event) => manejarErrorMontaje(cameraInstance, event)}
            />
            {!cameraReady ? (
              <View style={styles.initializingOverlay}>
                <ActivityIndicator color="#FFFFFF" />
                <Text style={styles.message}>Iniciando cámara...</Text>
                <TouchableOpacity style={styles.secondaryButton} onPress={cancelar} disabled={procesando}>
                  <Text style={styles.secondaryText}>Cerrar</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.actions}>
                <TouchableOpacity
                  style={[styles.primaryButton, (capturando || capturaNativaPendiente) && styles.disabled]}
                  onPress={tomarFoto}
                  disabled={capturando || capturaNativaPendiente}
                >
                  {capturando
                    ? <ActivityIndicator color="#FFFFFF" />
                    : <Text style={styles.primaryText}>{capturaNativaPendiente ? 'Finalizando cámara...' : 'Tomar foto'}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={cancelar}>
                  <Text style={styles.secondaryText}>Cancelar</Text>
                </TouchableOpacity>
              </View>
            )}
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
  initializingOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 2, elevation: 2, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: '#05080D', paddingHorizontal: spacing.lg },
  preview: { flex: 1, width: '100%' },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md },
  primaryButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.base, paddingHorizontal: spacing.md },
  primaryText: { color: '#FFFFFF', fontSize: fontSizes.medium, fontWeight: '700' },
  secondaryButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF', borderRadius: radius.base, paddingHorizontal: spacing.md },
  secondaryText: { color: '#FFFFFF', fontSize: fontSizes.medium, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  error: { color: '#FFB4AB', fontSize: fontSizes.small, paddingTop: spacing.sm, textAlign: 'center' },
});
