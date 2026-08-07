import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  StyleSheet,
  Alert,
} from 'react-native';
import { colors, spacing, fontSizes, radius } from '../styles/theme';
import NotificacionItem from './NotificacionItem';
import {
  obtenerNotificacionesUsuario,
  marcarNotificacionLeida,
  obtenerConteoDestinatariosSinId,
} from '../lib/notificaciones';

export default function NotificacionesScreen({ usuarioId, onUnreadCountChange }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [markingId, setMarkingId] = useState(null);

  const unreadCount = useMemo(
    () => items.reduce((acc, item) => acc + (item?.isRead ? 0 : 1), 0),
    [items]
  );

  const cargar = useCallback(async ({ silent = false } = {}) => {
    if (!usuarioId) {
      setLoading(false);
      setItems([]);
      setError(null);
      onUnreadCountChange?.(0);
      return;
    }

    try {
      if (!silent) setLoading(true);
      setError(null);
      const sinId = await obtenerConteoDestinatariosSinId(usuarioId);
      if (sinId > 0) {
        console.warn(`⚠️ Integridad de datos: destinatarios sin id = ${sinId}`);
      }
      const lista = await obtenerNotificacionesUsuario(usuarioId);
      setItems(lista);
      onUnreadCountChange?.(lista.reduce((acc, item) => acc + (item.isRead ? 0 : 1), 0));
    } catch (e) {
      const msg = e?.message || 'No se pudieron cargar las notificaciones.';
      setError(msg);
      setItems([]);
      onUnreadCountChange?.(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onUnreadCountChange, usuarioId]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    cargar({ silent: true });
  }, [cargar]);

  const onPressItem = useCallback(async (item) => {
    if (!item || item.isRead || !item.destinatarioId) return;

    try {
      setMarkingId(item.destinatarioId);
      const result = await marcarNotificacionLeida(item.destinatarioId);
      const leidaAt = result?.leida_at || item?.leidaAt || new Date().toISOString();

      setItems((prev) => {
        const updated = prev.map((row) => (
          row.destinatarioId === item.destinatarioId
            ? {
                ...row,
                isRead: true,
                leidaAt,
              }
            : row
        ));
        onUnreadCountChange?.(updated.reduce((acc, row) => acc + (row.isRead ? 0 : 1), 0));
        return updated;
      });
    } catch (e) {
      Alert.alert('Error', e?.message || 'No se pudo marcar la notificación como leída.');
    } finally {
      setMarkingId(null);
    }
  }, [onUnreadCountChange]);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={styles.infoText}>Cargando notificaciones...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerCard}>
        <Text style={styles.titulo}>Notificaciones</Text>
        <Text style={styles.subtitulo}>
          {items.length} total · {unreadCount} sin leer
        </Text>
      </View>

      {error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>No se pudieron cargar las notificaciones.</Text>
          <Text style={styles.errorDetail}>{error}</Text>
          <Text style={styles.retryText} onPress={() => cargar()}>
            Reintentar
          </Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No tienes notificaciones.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => String(item.destinatarioId || item.notificacionId)}
          renderItem={({ item }) => (
            <NotificacionItem
              item={item}
              onPress={onPressItem}
              disabled={markingId === item.destinatarioId}
            />
          )}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCard: {
    backgroundColor: colors.headerBg,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    shadowColor: '#08131F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 9,
    elevation: 4,
  },
  titulo: {
    fontSize: fontSizes.large,
    fontWeight: '700',
    color: colors.headerText,
  },
  subtitulo: {
    marginTop: 4,
    color: '#CDDBEA',
    fontSize: fontSizes.small,
  },
  infoText: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    marginTop: spacing.sm,
  },
  listContent: {
    paddingBottom: 100,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSizes.medium,
    textAlign: 'center',
  },
  errorText: {
    color: colors.danger,
    fontSize: fontSizes.medium,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorDetail: {
    marginTop: 6,
    color: colors.textMuted,
    fontSize: fontSizes.small,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
  },
  retryText: {
    marginTop: spacing.md,
    color: colors.primary,
    fontWeight: '700',
    fontSize: fontSizes.small,
  },
});
