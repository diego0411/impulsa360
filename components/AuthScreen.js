import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Image,
  Animated,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { supabase } from '../lib/supabase';
import { normalizarNombreVisible } from '../lib/identity';
import { obtenerPlazasTemporales } from '../lib/plazasTemporales';
import { withTimeout, isTimeoutError } from '../lib/asyncTimeout';
import { enmascararMarcaVisible } from '../lib/brandMask';
import { secureLocalStorage } from '../lib/secureLocalStorage';
import { colors, spacing, fontSizes, radius } from '../styles/theme';
import {
  getOfflinePinStatus,
  pinPolicy,
  saveOfflinePin,
  verifyOfflinePin,
} from '../lib/offlinePin';

const formatSecondsToMinSec = (seconds = 0) => {
  const safeSeconds = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
};
const AUTH_TIMEOUT_MS = 12000;
const QUERY_TIMEOUT_MS = 10000;
const isDev = typeof __DEV__ !== 'undefined' && __DEV__;

const normalizePinInput = (value) =>
  String(value || '').replace(/\D/g, '').slice(0, pinPolicy.maxLength);

export default function AuthScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [isConnected, setIsConnected] = useState(null);
  const [cachedUser, setCachedUser] = useState(null);
  const [offlineReady, setOfflineReady] = useState(false);
  const [offlinePinConfigured, setOfflinePinConfigured] = useState(false);
  const [offlinePinAttemptsLeft, setOfflinePinAttemptsLeft] = useState(pinPolicy.maxFailedAttempts);
  const [offlinePinLockSeconds, setOfflinePinLockSeconds] = useState(0);
  const [offlinePinInput, setOfflinePinInput] = useState('');

  const [pinSetupUser, setPinSetupUser] = useState(null);
  const [pinSetupValue, setPinSetupValue] = useState('');
  const [pinSetupConfirm, setPinSetupConfirm] = useState('');

  const heroAnim = useRef(new Animated.Value(0)).current;
  const cardAnim = useRef(new Animated.Value(0)).current;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    Animated.stagger(120, [
      Animated.timing(heroAnim, {
        toValue: 1,
        duration: 520,
        useNativeDriver: false,
      }),
      Animated.timing(cardAnim, {
        toValue: 1,
        duration: 520,
        useNativeDriver: false,
      }),
    ]).start();

    return () => {
      mountedRef.current = false;
    };
  }, [cardAnim, heroAnim]);

  const hydrateOfflineState = useCallback(async ({ knownIsConnected } = {}) => {
    const netOnline =
      typeof knownIsConnected === 'boolean'
        ? knownIsConnected
        : !!(await NetInfo.fetch())?.isConnected;
    if (!mountedRef.current) return;
    setIsConnected(netOnline);

    let usuarioLocal = null;
    try {
      const storedRaw = await secureLocalStorage.getItem('usuario_autenticado_local');
      const stored = storedRaw ? JSON.parse(storedRaw) : null;
      if (stored?.id) {
        usuarioLocal = stored;
      }
    } catch {
      // ignorar cache inválido
    }
    if (!mountedRef.current) return;
    setCachedUser(usuarioLocal);

    if (usuarioLocal?.id) {
      const pinStatus = await getOfflinePinStatus(usuarioLocal.id);
      if (!mountedRef.current) return;
      setOfflinePinConfigured(pinStatus.configured);
      setOfflinePinLockSeconds(pinStatus.remainingSeconds || 0);
      setOfflinePinAttemptsLeft(pinStatus.attemptsLeft ?? pinPolicy.maxFailedAttempts);
    } else {
      if (!mountedRef.current) return;
      setOfflinePinConfigured(false);
      setOfflinePinLockSeconds(0);
      setOfflinePinAttemptsLeft(pinPolicy.maxFailedAttempts);
    }

    if (!mountedRef.current) return;
    setOfflineReady(true);
  }, []);

  useEffect(() => {
    let mounted = true;
    hydrateOfflineState();

    const unsubscribe = NetInfo.addEventListener((state) => {
      if (!mounted) return;
      hydrateOfflineState({ knownIsConnected: !!state?.isConnected });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [hydrateOfflineState]);

  useEffect(() => {
    if (offlinePinLockSeconds <= 0) return;

    const timer = globalThis.setInterval(() => {
      setOfflinePinLockSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    return () => globalThis.clearInterval(timer);
  }, [offlinePinLockSeconds]);

  const continuarConUsuario = useCallback((usuarioFinal) => {
    if (!usuarioFinal?.id) return;

    setOfflinePinInput('');
    setPinSetupUser(null);
    setPinSetupValue('');
    setPinSetupConfirm('');
    onLogin(usuarioFinal);
  }, [onLogin]);

  const manejarIngresoOfflineConPin = async () => {
    if (submitting) return;

    if (!cachedUser?.id) {
      Alert.alert('Sin sesión local', 'Primero inicia sesión una vez con internet.');
      return;
    }

    const pin = normalizePinInput(offlinePinInput);
    if (pin.length < pinPolicy.minLength || pin.length > pinPolicy.maxLength) {
      Alert.alert('PIN inválido', `Ingresa un PIN de ${pinPolicy.minLength} a ${pinPolicy.maxLength} dígitos.`);
      return;
    }

    setSubmitting(true);
    try {
      const result = await verifyOfflinePin({ userId: cachedUser.id, pin });

      if (result.ok) {
        continuarConUsuario(cachedUser);
        return;
      }

      if (result.reason === 'locked') {
        const seconds = result.remainingSeconds || pinPolicy.lockWindowMs / 1000;
        setOfflinePinLockSeconds(seconds);
        setOfflinePinInput('');
        Alert.alert('PIN bloqueado', `Demasiados intentos. Intenta nuevamente en ${formatSecondsToMinSec(seconds)}.`);
      } else if (result.reason === 'invalid_pin') {
        const attemptsLeft = result.attemptsLeft ?? 0;
        setOfflinePinAttemptsLeft(attemptsLeft);
        Alert.alert('PIN incorrecto', attemptsLeft > 0 ? `Te quedan ${attemptsLeft} intento(s).` : 'Intenta nuevamente.');
      } else if (result.reason === 'not_configured') {
        setOfflinePinConfigured(false);
        Alert.alert('PIN no configurado', 'Conéctate a internet e inicia sesión para configurar tu PIN local.');
      } else {
        Alert.alert('No se pudo validar PIN', 'Verifica tus datos e intenta de nuevo.');
      }
    } catch (err) {
      Alert.alert('Error', err?.message || 'No se pudo validar el PIN.');
    } finally {
      setSubmitting(false);
      await hydrateOfflineState({ knownIsConnected: false });
    }
  };

  const guardarPinYContinuar = async () => {
    if (submitting) return;
    if (!pinSetupUser?.id) return;

    const pin = normalizePinInput(pinSetupValue);
    const confirm = normalizePinInput(pinSetupConfirm);

    if (pin.length < pinPolicy.minLength || pin.length > pinPolicy.maxLength) {
      Alert.alert('PIN inválido', `El PIN debe tener entre ${pinPolicy.minLength} y ${pinPolicy.maxLength} dígitos.`);
      return;
    }

    if (pin !== confirm) {
      Alert.alert('PIN no coincide', 'La confirmación debe ser exactamente igual.');
      return;
    }

    setSubmitting(true);
    try {
      await saveOfflinePin({ userId: pinSetupUser.id, pin });
      await hydrateOfflineState({ knownIsConnected: true });
      continuarConUsuario(pinSetupUser);
    } catch (err) {
      Alert.alert('No se pudo guardar PIN', err?.message || 'Intenta nuevamente.');
    } finally {
      setSubmitting(false);
    }
  };

  const omitirPinPorAhora = () => {
    if (!pinSetupUser?.id) return;

    Alert.alert(
      'Continuar sin PIN',
      'Podrás usar la app en línea, pero sin internet no podrás desbloquear de forma segura hasta configurar tu PIN.',
      [
        { text: 'Volver', style: 'cancel' },
        {
          text: 'Continuar',
          style: 'destructive',
          onPress: () => continuarConUsuario(pinSetupUser),
        },
      ],
    );
  };

  const manejarAutenticacion = async () => {
    if (submitting) return;

    const emailNormalizado = email.trim().toLowerCase();
    const passwordNormalizado = password;
    const netState = await NetInfo.fetch();

    if (!netState.isConnected) {
      Alert.alert('Sin conexión', 'Necesitas conexión a internet para autenticarte.');
      return;
    }

    if (!emailNormalizado || !passwordNormalizado) {
      Alert.alert('Error', 'Completa todos los campos.');
      return;
    }

    setSubmitting(true);
    try {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({
          email: emailNormalizado,
          password: passwordNormalizado,
        }),
        AUTH_TIMEOUT_MS,
        'La señal está muy débil. Intenta de nuevo o usa modo offline si ya tienes PIN.'
      );

      if (error) {
        Alert.alert('Error', enmascararMarcaVisible(error.message, pinSetupUser || cachedUser));
        return;
      }

      const usuario = data.user;
      if (!usuario?.id) {
        Alert.alert('Error', 'No se pudo recuperar la sesión del usuario.');
        return;
      }

      let usuarioCache = null;
      try {
        const storedRaw = await secureLocalStorage.getItem('usuario_autenticado_local');
        const stored = storedRaw ? JSON.parse(storedRaw) : null;
        if (stored?.id === usuario.id) {
          usuarioCache = stored;
        }
      } catch {
        // ignorar cache inválido
      }

      // Consultas independientes en paralelo: perfil (autorización), roles
      // (multirrol) y plazas (formulario). Ninguna bloquea a otra.
      const [perfilResult, filasRoles, plazasTemporales] = await Promise.all([
        withTimeout(
          supabase
            .from('activadores')
            .select('*')
            .eq('usuario_id', usuario.id)
            .single(),
          QUERY_TIMEOUT_MS,
          'La señal está muy débil al cargar el perfil.'
        ),
        withTimeout(
          supabase.from('activador_roles').select('rol').eq('usuario_id', usuario.id),
          QUERY_TIMEOUT_MS,
          'La señal está muy débil al cargar los roles.'
        ).then(({ data: rolesData }) => (Array.isArray(rolesData) ? rolesData : [])).catch(() => []),
        obtenerPlazasTemporales({ activadorId: usuario.id, usuarioId: usuario.id }),
      ]);
      const perfil = perfilResult?.data;
      const errorPerfil = perfilResult?.error;
      if (errorPerfil) {
        if (isDev) {
          console.warn('No se pudo obtener el perfil del impulsador:', errorPerfil.message);
        }
      }
      const rolesCrudos = [
        perfil?.rol || perfil?.role,
        ...filasRoles.map((fila) => fila?.rol),
        ...(Array.isArray(usuarioCache?.roles) ? usuarioCache.roles : []),
      ].filter((rol) => typeof rol === 'string' && rol.trim());

      const nombrePerfil = normalizarNombreVisible(perfil?.nombre || '');
      const nombreCache = normalizarNombreVisible(usuarioCache?.nombre || '');
      const nombreMetadata = normalizarNombreVisible(usuario.user_metadata?.nombre || '');
      const plazaPerfil = normalizarNombreVisible(perfil?.plaza || '');
      const plazaCache = normalizarNombreVisible(usuarioCache?.plaza || '');

      const usuarioFinal = {
        id: usuario.id,
        email: usuario.email,
        nombre: nombrePerfil || nombreCache || nombreMetadata || usuario.email,
        plaza: plazaPerfil || plazaCache || 'No especificada',
        plazas_temporales: plazasTemporales,
        rol: perfil?.rol || perfil?.role || usuarioCache?.rol || usuarioCache?.role || usuario.user_metadata?.rol || usuario.user_metadata?.role || 'activador',
        roles: Array.from(new Set(rolesCrudos)),
        puede_activar: perfil?.puede_activar === true || usuarioCache?.puede_activar === true,
      };

      await secureLocalStorage.setItem('usuario_autenticado_local', JSON.stringify(usuarioFinal));
      const pinStatus = await getOfflinePinStatus(usuarioFinal.id);

      if (!pinStatus.configured) {
        setPinSetupUser(usuarioFinal);
        setPinSetupValue('');
        setPinSetupConfirm('');
        setOfflinePinInput('');
        return;
      }

      continuarConUsuario(usuarioFinal);
    } catch (err) {
      Alert.alert(isTimeoutError(err) ? 'Conexión lenta' : 'Error crítico', enmascararMarcaVisible(err?.message || 'Ocurrió un error inesperado.', pinSetupUser || cachedUser));
      if (isDev) {
        console.error('Error en autenticación:', err);
      }
    } finally {
      if (mountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  const lockActive = offlinePinLockSeconds > 0;
  const mostrarSetupPin = !!pinSetupUser?.id;
  const mostrarOfflineConPin = !mostrarSetupPin && offlineReady && !isConnected && !!cachedUser?.id && offlinePinConfigured;
  const mostrarOfflineSinPin = !mostrarSetupPin && offlineReady && !isConnected && !!cachedUser?.id && !offlinePinConfigured;
  const mostrarOfflineSinSesion = !mostrarSetupPin && offlineReady && !isConnected && !cachedUser?.id;

  const chipLabel = isConnected ? 'En línea' : 'Sin internet';
  const usuarioSetupVisible = enmascararMarcaVisible(pinSetupUser?.nombre || pinSetupUser?.email || '', pinSetupUser);
  const usuarioCacheVisible = enmascararMarcaVisible(cachedUser?.nombre || cachedUser?.email || '', cachedUser);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.backdrop} />
      <View style={[styles.mesh, styles.meshA]} />
      <View style={[styles.mesh, styles.meshB]} />
      <View style={[styles.mesh, styles.meshC]} />
      <View style={styles.gridVeil} />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.hero,
            {
              opacity: heroAnim,
              transform: [
                {
                  translateY: heroAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [16, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View style={styles.kickerRow}>
            <View style={styles.kickerDot} />
            <Text style={styles.kicker}>PLATAFORMA OPERATIVA</Text>
          </View>
          <Text style={styles.titulo}>Impulsa 360</Text>
          <Text style={styles.tituloAccent}>Field Command</Text>
          <Text style={styles.subtitulo}>
            Control de activaciones con sincronización segura y respaldo inteligente.
          </Text>

          <View style={styles.brandRow}>
            <View style={styles.logoWrap}>
              <Image source={require('../assets/icon.png')} style={styles.logo} resizeMode="cover" />
            </View>
            <View style={styles.brandTextWrap}>
              <Text style={styles.brandTitle}>Cuenta corporativa</Text>
              <Text style={styles.brandHint}>Acceso para equipos de campo</Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Text style={styles.statValue}>24/7</Text>
              <Text style={styles.statLabel}>Sync</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statValue}>PIN</Text>
              <Text style={styles.statLabel}>Offline</Text>
            </View>
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.card,
            {
              opacity: cardAnim,
              transform: [
                {
                  translateY: cardAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [24, 0],
                  }),
                },
              ],
            },
          ]}
        >
        <View style={styles.cardTopAccent} />
        <View style={styles.cardHeaderRow}>
          <View style={[styles.connectionChip, isConnected ? styles.connectionChipOnline : styles.connectionChipOffline]}>
            <Text style={styles.connectionChipText}>{chipLabel}</Text>
          </View>
        </View>

        {mostrarSetupPin ? (
          <>
            <Text style={styles.cardTitle}>Configura tu PIN local</Text>
            <Text style={styles.cardSub}>
              Define un PIN de {pinPolicy.minLength} a {pinPolicy.maxLength} dígitos para desbloquear la app sin internet.
            </Text>

            <Text style={styles.userPreview}>Usuario: {usuarioSetupVisible}</Text>

            <Text style={styles.fieldLabel}>Nuevo PIN</Text>
            <TextInput
              style={styles.input}
              placeholder="Ejemplo: 1234"
              placeholderTextColor={colors.muted}
              value={pinSetupValue}
              onChangeText={(v) => setPinSetupValue(normalizePinInput(v))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={pinPolicy.maxLength}
            />

            <Text style={styles.fieldLabel}>Confirmar PIN</Text>
            <TextInput
              style={styles.input}
              placeholder="Repite el PIN"
              placeholderTextColor={colors.muted}
              value={pinSetupConfirm}
              onChangeText={(v) => setPinSetupConfirm(normalizePinInput(v))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={pinPolicy.maxLength}
            />

            <TouchableOpacity
              onPress={guardarPinYContinuar}
              style={[styles.boton, submitting && styles.botonDisabled]}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.botonTexto}>Guardar PIN y continuar</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={omitirPinPorAhora}
              style={styles.secondaryBtn}
              disabled={submitting}
              activeOpacity={0.8}
            >
              <Text style={styles.secondaryBtnText}>Omitir por ahora</Text>
            </TouchableOpacity>
          </>
        ) : mostrarOfflineConPin ? (
          <>
            <Text style={styles.cardTitle}>Acceso sin internet</Text>
            <Text style={styles.cardSub}>
              Ingresa tu PIN local para desbloquear la sesión guardada en este dispositivo.
            </Text>

            <Text style={styles.userPreview}>Usuario: {usuarioCacheVisible}</Text>

            <Text style={styles.fieldLabel}>PIN local</Text>
            <TextInput
              style={styles.input}
              placeholder="PIN"
              placeholderTextColor={colors.muted}
              value={offlinePinInput}
              onChangeText={(v) => setOfflinePinInput(normalizePinInput(v))}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={pinPolicy.maxLength}
              editable={!lockActive && !submitting}
            />

            {lockActive ? (
              <Text style={styles.helperDanger}>
                Bloqueado temporalmente. Reintenta en {formatSecondsToMinSec(offlinePinLockSeconds)}.
              </Text>
            ) : (
              <Text style={styles.helperMuted}>
                Intentos restantes: {offlinePinAttemptsLeft}
              </Text>
            )}

            <TouchableOpacity
              onPress={manejarIngresoOfflineConPin}
              style={[styles.boton, (submitting || lockActive) && styles.botonDisabled]}
              disabled={submitting || lockActive}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.botonTexto}>Desbloquear</Text>
              )}
            </TouchableOpacity>
          </>
        ) : mostrarOfflineSinPin ? (
          <>
            <Text style={styles.cardTitle}>Modo sin internet</Text>
            <Text style={styles.cardSub}>
              Tienes sesión local guardada, pero aún no configuraste un PIN para desbloqueo offline seguro.
            </Text>
            <Text style={styles.userPreview}>Usuario: {usuarioCacheVisible}</Text>
            <Text style={styles.helperMuted}>
              Conéctate una vez a internet, inicia sesión y crea tu PIN local.
            </Text>
          </>
        ) : mostrarOfflineSinSesion ? (
          <>
            <Text style={styles.cardTitle}>Sin sesión local</Text>
            <Text style={styles.cardSub}>
              Este dispositivo no tiene una sesión activa en caché. Debes iniciar sesión con internet al menos una vez.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.cardTitle}>Iniciar sesión</Text>
            <Text style={styles.cardSub}>Tu sesión se vinculará a tu perfil de activador</Text>

            <Text style={styles.fieldLabel}>Correo</Text>
            <TextInput
              style={styles.input}
              placeholder="Correo electrónico"
              placeholderTextColor={colors.muted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />

            <Text style={styles.fieldLabel}>Contraseña</Text>
            <TextInput
              style={styles.input}
              placeholder="Contraseña"
              placeholderTextColor={colors.muted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <TouchableOpacity
              onPress={manejarAutenticacion}
              style={[styles.boton, submitting && styles.botonDisabled]}
              disabled={submitting}
              activeOpacity={0.85}
            >
              {submitting ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.botonTexto}>Entrar al panel</Text>
              )}
            </TouchableOpacity>
          </>
        )}
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050D16',
    overflow: 'hidden',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg - 2,
    paddingVertical: spacing.xl,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#091423',
  },
  mesh: {
    position: 'absolute',
    borderRadius: 999,
  },
  meshA: {
    width: 320,
    height: 320,
    top: -110,
    right: -80,
    backgroundColor: 'rgba(41, 122, 255, 0.34)',
  },
  meshB: {
    width: 300,
    height: 300,
    bottom: -150,
    left: -120,
    backgroundColor: 'rgba(255, 138, 0, 0.2)',
  },
  meshC: {
    width: 260,
    height: 260,
    top: '28%',
    left: -120,
    backgroundColor: 'rgba(29, 71, 138, 0.32)',
  },
  gridVeil: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 13, 22, 0.38)',
  },
  hero: {
    marginBottom: spacing.md,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  kickerDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    marginRight: 8,
    backgroundColor: colors.accent,
  },
  kicker: {
    color: '#9BB8D7',
    fontSize: 11,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  titulo: {
    fontSize: 40,
    fontWeight: '700',
    color: '#F7FBFF',
    lineHeight: 44,
  },
  tituloAccent: {
    fontSize: 30,
    color: '#BFD4EA',
    fontWeight: '600',
    marginBottom: 2,
  },
  subtitulo: {
    fontSize: 15,
    color: '#A6BED6',
    lineHeight: 22,
    maxWidth: '94%',
  },
  brandRow: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(215, 231, 247, 0.18)',
    padding: 10,
    borderRadius: 16,
  },
  logoWrap: {
    width: 56,
    height: 56,
    borderRadius: 16,
    padding: 4,
    backgroundColor: 'rgba(255,255,255,0.88)',
  },
  logo: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  brandTextWrap: {
    marginLeft: 12,
    flex: 1,
  },
  brandTitle: {
    color: '#FFFFFF',
    fontSize: fontSizes.medium,
    fontWeight: '700',
  },
  brandHint: {
    color: '#BDD2E8',
    fontSize: 13,
    marginTop: 2,
  },
  statsRow: {
    marginTop: 12,
    flexDirection: 'row',
    gap: 8,
  },
  statPill: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(202, 220, 238, 0.2)',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    minWidth: 84,
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  statLabel: {
    color: '#B5CCE3',
    fontSize: 11,
    marginTop: 1,
    letterSpacing: 0.3,
  },
  card: {
    backgroundColor: '#FDFEFF',
    borderWidth: 1,
    borderColor: '#D6E3F0',
    borderRadius: 24,
    padding: spacing.lg,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 8,
  },
  cardTopAccent: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 5,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: colors.primary,
  },
  cardHeaderRow: {
    alignItems: 'flex-start',
    marginBottom: spacing.sm,
  },
  connectionChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
  },
  connectionChipOnline: {
    backgroundColor: 'rgba(15, 169, 104, 0.12)',
    borderColor: 'rgba(12, 130, 83, 0.32)',
  },
  connectionChipOffline: {
    backgroundColor: 'rgba(214, 58, 69, 0.1)',
    borderColor: 'rgba(184, 38, 49, 0.28)',
  },
  connectionChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#17314A',
  },
  cardTitle: {
    color: '#12263A',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 2,
  },
  cardSub: {
    color: colors.textMuted,
    fontSize: 13,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  userPreview: {
    color: '#1C344D',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    color: '#1C344D',
    fontSize: fontSizes.small,
    fontWeight: '700',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#F5F9FD',
    borderColor: '#CBDCEC',
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    fontSize: fontSizes.medium,
    color: colors.text,
    marginBottom: spacing.md,
  },
  helperMuted: {
    color: '#506C86',
    fontSize: 13,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  helperDanger: {
    color: '#B4232A',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  boton: {
    backgroundColor: '#1158DE',
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
    minHeight: 50,
    shadowColor: '#0B3C9A',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.28,
    shadowRadius: 8,
    elevation: 5,
  },
  botonDisabled: {
    opacity: 0.72,
  },
  botonTexto: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  secondaryBtnText: {
    color: '#355777',
    fontSize: 14,
    fontWeight: '600',
  },
});
