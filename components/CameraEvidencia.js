import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import { colors, fontSizes, radius, spacing } from '../styles/theme';
import { TimeoutError, withTimeout } from '../lib/asyncTimeout';
import {
  crearIdCamara,
  finalizarHitoCamara,
  marcarHitoCamaraInterrumpido,
  registrarErrorFoto,
  registrarHitoCamara,
} from '../lib/photoDiagnostics';
import { evaluarDimensionesCaptura, seleccionarPictureSizeSeguro } from '../lib/cameraPhotoSafety';
import {
  VISTA_CAMARA,
  VISTA_PREVIEW,
  bucketDimensionesLayout,
  camaraReutilizableEnPreview,
  construirEntregaFoto,
  construirFotoPreview,
  mantenerCamaraMontadaEnPreview,
  resolverVistaCamara,
} from '../lib/cameraCaptureFlow';
import { recordPhotoDiagnostic } from '../lib/telemetry';

const PERMISSION_TIMEOUT_MS = 10000;
const CAMERA_READY_TIMEOUT_MS = 10000;
const CAPTURE_TIMEOUT_MS = 25000;
const FILE_CLEANUP_TIMEOUT_MS = 10000;
const PICTURE_SIZE_TIMEOUT_MS = 5000;
const PICTURE_SIZE_APPLY_TIMEOUT_MS = 4000;
const PICTURE_SIZE_INICIAL = Platform.OS === 'ios' ? '1280x720' : '';

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
  const cameraProcessIdRef = useRef('');
  const previewReportadoRef = useRef(false);
  const previewLayoutReportadoRef = useRef(false);
  const entregaPendienteRef = useRef(null);
  const entregadaRef = useRef(false);
  const pictureSizeRef = useRef(PICTURE_SIZE_INICIAL);
  const resolviendoPictureSizeRef = useRef(false);
  const esperandoPictureSizeRef = useRef(false);
  const temporizadorPictureSizeRef = useRef(null);
  const appStateRef = useRef(AppState.currentState);
  const remontajeDiferidoRef = useRef(false);
  const fotoCapturadaUriRef = useRef('');
  const [pictureSize, setPictureSize] = useState(PICTURE_SIZE_INICIAL);
  const [permission, requestPermission] = useCameraPermissions();
  const [modalShown, setModalShown] = useState(false);
  const [cameraInstance, setCameraInstance] = useState(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [fotoCapturada, setFotoCapturada] = useState(null);
  const [capturando, setCapturando] = useState(false);
  const [capturaNativaPendiente, setCapturaNativaPendiente] = useState(false);
  const [procesando, setProcesando] = useState(false);
  const [previewError, setPreviewError] = useState(false);
  const [entregaLista, setEntregaLista] = useState(false);
  const [error, setError] = useState('');

  const reportarHito = useCallback((stage, campos = {}) => {
    const cameraId = cameraProcessIdRef.current;
    registrarHitoCamara(cameraId, stage, campos).catch(() => {});
    recordPhotoDiagnostic(stage, {
      screen: 'camera',
      status: campos.status,
      errorCategory: campos.errorCategory,
    }).catch(() => {});
  }, []);

  const reportarError = useCallback(async (stage, cameraError, fallback) => {
    const code = await registrarErrorFoto(stage, cameraError);
    reportarHito(code, {
      status: 'error',
      errorCategory: code.endsWith('-TIMEOUT') ? 'timeout' : `${stage}_error`,
    });
    return `${fallback} (${code})`;
  }, [reportarHito]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sessionRef.current += 1;
      cameraInstanceRef.current += 1;
      if (!entregadaRef.current && cameraProcessIdRef.current) {
        marcarHitoCamaraInterrumpido(cameraProcessIdRef.current).catch(() => {});
      }
      if (temporizadorPictureSizeRef.current) {
        globalThis.clearTimeout(temporizadorPictureSizeRef.current);
        temporizadorPictureSizeRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    sessionRef.current += 1;
    cameraInstanceRef.current += 1;
    permisoSolicitadoRef.current = false;
    permisoReportadoRef.current = false;
    inicioAutomaticoRef.current = false;
    cameraRef.current = null;
    if (temporizadorPictureSizeRef.current) {
      globalThis.clearTimeout(temporizadorPictureSizeRef.current);
      temporizadorPictureSizeRef.current = null;
    }
    resolviendoPictureSizeRef.current = false;
    esperandoPictureSizeRef.current = false;
    remontajeDiferidoRef.current = false;
    fotoCapturadaUriRef.current = '';
    pictureSizeRef.current = PICTURE_SIZE_INICIAL;
    setPictureSize(PICTURE_SIZE_INICIAL);
    setModalShown(false);
    setCameraInstance(null);
    if (!visible) {
      if (!entregadaRef.current && cameraProcessIdRef.current) {
        finalizarHitoCamara(cameraProcessIdRef.current, 'SESSION_CLOSED').catch(() => {});
      }
      return;
    }
    cameraProcessIdRef.current = crearIdCamara();
    entregadaRef.current = false;
    previewReportadoRef.current = false;
    previewLayoutReportadoRef.current = false;
    entregaPendienteRef.current = null;
    setCameraReady(false);
    setFotoCapturada(null);
    setCapturando(false);
    setCapturaNativaPendiente(Boolean(capturaOperacionRef.current));
    procesandoRef.current = false;
    setProcesando(false);
    setPreviewError(false);
    setEntregaLista(false);
    setError('');
    reportarHito('CAMERA_OPEN');
  }, [reportarHito, visible]);

  useEffect(() => {
    if (!entregaLista) return;
    const entrega = entregaPendienteRef.current;
    entregaPendienteRef.current = null;
    setEntregaLista(false);
    if (!entrega?.uri) return;
    entregadaRef.current = true;
    reportarHito('CAMERA_HANDOFF');
    onUse(entrega.uri, {
      width: entrega.width,
      height: entrega.height,
      cameraProcessId: entrega.cameraProcessId,
    });
  }, [entregaLista, onUse, reportarHito]);

  useEffect(() => {
    if (!visible || !modalShown || !permission?.granted || permisoReportadoRef.current) return;
    permisoReportadoRef.current = true;
    reportarHito('PERMISSION_GRANTED');
  }, [modalShown, permission?.granted, reportarHito, visible]);

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
    reportarHito('CAMERA_MOUNTED');
  }, [cameraInstance, error, fotoCapturada, modalShown, permission?.granted, reportarHito, visible]);

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
  }, [modalShown, permission, reportarError, visible]);

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
  }, [cameraInstance, cameraReady, fotoCapturada, modalShown, permission?.granted, reportarError, visible]);

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
  }, [modalShown, permission, reportarError, requestPermission, visible]);

  const resolverPictureSize = async (instance) => {
    if (resolviendoPictureSizeRef.current) return;
    resolviendoPictureSizeRef.current = true;
    const session = sessionRef.current;
    let seleccion = { status: 'unknown', size: '' };
    try {
      const sizes = await withTimeout(
        Promise.resolve(cameraRef.current?.getAvailablePictureSizesAsync?.() ?? []),
        PICTURE_SIZE_TIMEOUT_MS,
        'La consulta de resoluciones de cámara excedió el tiempo permitido.'
      );
      if (
        !mountedRef.current
        || sessionRef.current !== session
        || cameraInstanceRef.current !== instance
      ) return;
      seleccion = seleccionarPictureSizeSeguro(sizes);
    } catch {
      seleccion = { status: 'unknown', size: '' };
    } finally {
      if (cameraInstanceRef.current === instance) {
        resolviendoPictureSizeRef.current = false;
      }
    }
    if (
      !mountedRef.current
      || sessionRef.current !== session
      || cameraInstanceRef.current !== instance
    ) return;
    const soportado = seleccion.status === 'supported' && !!seleccion.size;
    reportarHito(`CAMERA_PICTURE_SIZE_${String(seleccion.status).toUpperCase()}`);
    if (!soportado || seleccion.size === pictureSizeRef.current) {
      setCameraReady(true);
      reportarHito('CAMERA_READY');
      return;
    }
    pictureSizeRef.current = seleccion.size;
    setPictureSize(seleccion.size);
    if (Platform.OS !== 'android') {
      setCameraReady(true);
      reportarHito('CAMERA_READY');
      return;
    }
    esperandoPictureSizeRef.current = true;
    temporizadorPictureSizeRef.current = globalThis.setTimeout(() => {
      temporizadorPictureSizeRef.current = null;
      esperandoPictureSizeRef.current = false;
      if (
        !mountedRef.current
        || sessionRef.current !== session
        || cameraInstanceRef.current !== instance
      ) return;
      cameraInstanceRef.current += 1;
      cameraRef.current = null;
      setCameraInstance(null);
      setCameraReady(false);
      setError('No se pudo aplicar la resolución de cámara. Reintenta.');
      reportarError('camera_ready', new TimeoutError('La cámara no confirmó la resolución aplicada.'), 'No se pudo aplicar la resolución de cámara.').then((message) => {
        if (mountedRef.current && sessionRef.current === session && cameraInstanceRef.current === instance + 1) setError(message);
      });
    }, PICTURE_SIZE_APPLY_TIMEOUT_MS);
  };

  const manejarCamaraLista = (instance) => {
    if (
      instance !== cameraInstanceRef.current
      || cameraInstance !== instance
      || procesandoRef.current
    ) return;
    if (esperandoPictureSizeRef.current) {
      if (temporizadorPictureSizeRef.current) {
        globalThis.clearTimeout(temporizadorPictureSizeRef.current);
        temporizadorPictureSizeRef.current = null;
      }
      esperandoPictureSizeRef.current = false;
      setCameraReady(true);
      reportarHito('CAMERA_READY');
      return;
    }
    if (cameraReady) return;
    resolverPictureSize(instance);
  };

  const reintentarCamara = () => {
    const instance = cameraInstanceRef.current + 1;
    cameraInstanceRef.current = instance;
    cameraRef.current = null;
    if (temporizadorPictureSizeRef.current) {
      globalThis.clearTimeout(temporizadorPictureSizeRef.current);
      temporizadorPictureSizeRef.current = null;
    }
    resolviendoPictureSizeRef.current = false;
    esperandoPictureSizeRef.current = false;
    setCameraReady(false);
    setError('');
    setCameraInstance(instance);
    reportarHito('CAMERA_MOUNTED');
  };

  const reconciliarCamara = useCallback(() => {
    if (!mountedRef.current || !visible || !modalShown || fotoCapturada) return;
    if (capturandoRef.current || capturaOperacionRef.current || procesandoRef.current) {
      remontajeDiferidoRef.current = true;
      return;
    }
    remontajeDiferidoRef.current = false;
    cameraInstanceRef.current += 1;
    cameraRef.current = null;
    if (temporizadorPictureSizeRef.current) {
      globalThis.clearTimeout(temporizadorPictureSizeRef.current);
      temporizadorPictureSizeRef.current = null;
    }
    resolviendoPictureSizeRef.current = false;
    esperandoPictureSizeRef.current = false;
    setCameraReady(false);
    setError('');
    setCameraInstance(cameraInstanceRef.current);
    reportarHito('CAMERA_REMOUNTED');
  }, [fotoCapturada, modalShown, reportarHito, visible]);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const sub = AppState.addEventListener('change', (nextState) => {
      const previousState = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState !== 'active' || previousState === 'active') return;
      if (!visible || !modalShown || !permission?.granted || fotoCapturada) return;
      reconciliarCamara();
    });
    return () => sub.remove();
  }, [fotoCapturada, modalShown, permission?.granted, reconciliarCamara, visible]);

  const manejarErrorMontaje = async (instance, event) => {
    if (instance !== cameraInstanceRef.current || cameraInstance !== instance) return;
    const session = sessionRef.current;
    cameraInstanceRef.current += 1;
    cameraRef.current = null;
    if (temporizadorPictureSizeRef.current) {
      globalThis.clearTimeout(temporizadorPictureSizeRef.current);
      temporizadorPictureSizeRef.current = null;
    }
    resolviendoPictureSizeRef.current = false;
    esperandoPictureSizeRef.current = false;
    setCameraInstance(null);
    setCameraReady(false);
    setError('No se pudo iniciar la cámara.');
    const message = await reportarError('camera_ready', event, 'No se pudo iniciar la cámara.');
    if (mountedRef.current && sessionRef.current === session && cameraInstanceRef.current === instance + 1) {
      setError(message);
    }
  };

  const tomarFoto = async () => {
    if (
      !cameraReady
      || capturandoRef.current
      || capturaOperacionRef.current
      || !cameraRef.current
      || !!fotoCapturadaUriRef.current
    ) return;
    capturandoRef.current = true;
    setCapturando(true);
    reportarHito('CAPTURE_START');
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
        if (
          fotoTardia?.uri
          && !operacion.invalidada
          && mountedRef.current
          && sessionRef.current === session
        ) {
          fotoCapturadaUriRef.current = fotoTardia.uri;
        }
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
        if (remontajeDiferidoRef.current && !fotoCapturadaUriRef.current) {
          reconciliarCamara();
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
      // Diagnóstico no bloqueante (build 71): la captura siempre pasa al
      // preview. El límite de resolución/6 MB se aplica aguas abajo en
      // prepararImagenPersistente, ya sobre la imagen persistida.
      const dimensiones = evaluarDimensionesCaptura({
        width: foto.width,
        height: foto.height,
      });
      reportarHito(`CAPTURE_DIM_${dimensiones.bucket}`, {
        dimensionBucket: dimensiones.bucket,
      });
      if (!mantenerCamaraMontadaEnPreview(Platform.OS)) {
        // iOS: se conserva el desmontaje de cámara del build 71.
        cameraInstanceRef.current += 1;
        cameraRef.current = null;
        setCameraInstance(null);
      }
      // Android (build 81): CameraView (SurfaceView) permanece montada y la
      // vista previa se superpone como capa opaca. Desmontar la cámara y
      // montar Image en el mismo commit dejaba el modal en blanco.
      setPreviewError(false);
      previewReportadoRef.current = false;
      previewLayoutReportadoRef.current = false;
      fotoCapturadaUriRef.current = foto.uri;
      setFotoCapturada(construirFotoPreview(foto));
      reportarHito('PREVIEW_START', { dimensionBucket: dimensiones.bucket });
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
    if (remontajeDiferidoRef.current && !fotoCapturadaUriRef.current) {
      reconciliarCamara();
    }
  };

  const usarFoto = () => {
    if (!fotoCapturada?.uri || procesandoRef.current || previewError) return;
    procesandoRef.current = true;
    if (mountedRef.current) setProcesando(true);
    reportarHito('CONFIRM_START');
    entregaPendienteRef.current = construirEntregaFoto(fotoCapturada, cameraProcessIdRef.current);
    remontajeDiferidoRef.current = false;
    fotoCapturadaUriRef.current = '';
    // Liberar la cámara montada (Android build 81) antes de cerrar el modal.
    cameraInstanceRef.current += 1;
    cameraRef.current = null;
    setCameraReady(false);
    setCameraInstance(null);
    setFotoCapturada(null);
    setModalShown(false);
    setEntregaLista(true);
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
    remontajeDiferidoRef.current = false;
    fotoCapturadaUriRef.current = '';
    setFotoCapturada(null);
    setPreviewError(false);
    setError('');
    reportarHito('REPEAT');
    // Android (build 81): si la cámara siguió montada durante el preview se
    // reutiliza tal cual; solo se retira la capa de vista previa. Si se perdió
    // (montaje fallido o instancia invalidada) se remonta UNA instancia nueva.
    if (
      !camaraReutilizableEnPreview({
        platform: Platform.OS,
        instance: cameraInstance,
        instanceActual: cameraInstanceRef.current,
      })
    ) {
      const instance = cameraInstanceRef.current + 1;
      cameraInstanceRef.current = instance;
      cameraRef.current = null;
      setCameraReady(false);
      setCameraInstance(instance);
      reportarHito('CAMERA_MOUNTED');
    }
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
    remontajeDiferidoRef.current = false;
    fotoCapturadaUriRef.current = '';
    finalizarHitoCamara(cameraProcessIdRef.current, 'CLOSED').catch(() => {});
    recordPhotoDiagnostic('CAMERA_CLOSED', {
      screen: 'camera',
      status: 'completed',
    }).catch(() => {});
    onCancel();
  };

  if (!visible) return null;

  const vistaCamara = resolverVistaCamara({ fotoCapturada, cameraInstance, error });

  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={cancelar}
      onShow={() => {
        if (!mountedRef.current || !visible) return;
        setModalShown(true);
        reportarHito('MODAL_OPEN');
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
        ) : vistaCamara === VISTA_PREVIEW || vistaCamara === VISTA_CAMARA ? (
          // Un único árbol para cámara y vista previa: en Android la CameraView
          // no se desmonta al capturar (build 81); la foto se monta como capa
          // opaca encima. La posición del CameraView no cambia entre vistas,
          // por lo que React lo reutiliza sin crear otra instancia.
          <View style={styles.content}>
            {cameraInstance !== null && (
              <View style={styles.cameraLayer} pointerEvents={vistaCamara === VISTA_PREVIEW ? 'none' : 'auto'}>
                <CameraView
                  key={`camera-${cameraInstance}`}
                  ref={cameraRef}
                  style={styles.camera}
                  facing="back"
                  mode="picture"
                  pictureSize={pictureSize || undefined}
                  onCameraReady={() => manejarCamaraLista(cameraInstance)}
                  onMountError={(event) => manejarErrorMontaje(cameraInstance, event)}
                />
                {vistaCamara === VISTA_CAMARA && !cameraReady && (
                  <View style={styles.initializingOverlay}>
                    <ActivityIndicator color="#FFFFFF" />
                    <Text style={styles.message}>Iniciando cámara...</Text>
                    <TouchableOpacity style={styles.secondaryButton} onPress={cancelar} disabled={procesando}>
                      <Text style={styles.secondaryText}>Cerrar</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}
            {vistaCamara === VISTA_CAMARA && cameraReady && (
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
            {vistaCamara === VISTA_PREVIEW && (
              <View
                style={styles.previewLayer}
                onLayout={(event) => {
                  if (previewLayoutReportadoRef.current) return;
                  previewLayoutReportadoRef.current = true;
                  const { width, height } = event.nativeEvent.layout || {};
                  // Telemetría mínima: solo el tramo del layout, sin valores
                  // exactos, para separar fallo de carga de Image vs layout.
                  reportarHito('PREVIEW_LAYOUT', {
                    dimensionBucket: bucketDimensionesLayout({ width, height }),
                  });
                }}
              >
                <Image
                  source={{ uri: fotoCapturada.uri }}
                  style={styles.preview}
                  resizeMode="contain"
                  resizeMethod="resize"
                  onLoad={() => {
                    if (previewReportadoRef.current) return;
                    previewReportadoRef.current = true;
                    reportarHito('PREVIEW_OK');
                  }}
                  onError={() => {
                    setPreviewError(true);
                    reportarError('preview', new Error('No se pudo cargar la vista previa de la foto.'), 'No se pudo mostrar la foto.').catch(() => {});
                  }}
                />
                {previewError && <Text style={styles.error}>No se pudo mostrar la foto. Repítela antes de continuar.</Text>}
                <View style={styles.actions}>
                  <TouchableOpacity style={[styles.primaryButton, (procesando || previewError) && styles.disabled]} onPress={usarFoto} disabled={procesando || previewError}>
                    {procesando ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Usar foto</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.secondaryButton, procesando && styles.disabled]} onPress={repetir} disabled={procesando}>
                    <Text style={styles.secondaryText}>Repetir</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        ) : (
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
  cameraLayer: { flex: 1, borderRadius: radius.base, overflow: 'hidden' },
  camera: { flex: 1 },
  initializingOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 2, elevation: 2, alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: '#05080D', paddingHorizontal: spacing.lg },
  previewLayer: { ...StyleSheet.absoluteFillObject, zIndex: 3, elevation: 3, backgroundColor: '#05080D' },
  preview: { flex: 1, width: '100%' },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingVertical: spacing.md },
  primaryButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.primary, borderRadius: radius.base, paddingHorizontal: spacing.md },
  primaryText: { color: '#FFFFFF', fontSize: fontSizes.medium, fontWeight: '700' },
  secondaryButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF', borderRadius: radius.base, paddingHorizontal: spacing.md },
  secondaryText: { color: '#FFFFFF', fontSize: fontSizes.medium, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  error: { color: '#FFB4AB', fontSize: fontSizes.small, paddingTop: spacing.sm, textAlign: 'center' },
});
