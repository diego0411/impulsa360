import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

function formatearFecha(value) {
  if (!value) return 'Fecha no disponible';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Fecha no disponible';

  return parsed.toLocaleString('es-ES', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function NotificacionItem({ item, onPress, disabled }) {
  const isRead = !!item?.isRead;

  return (
    <TouchableOpacity
      onPress={() => onPress?.(item)}
      activeOpacity={0.85}
      disabled={disabled}
    >
      <View style={[styles.card, !isRead && styles.cardUnread]}>
        <View style={styles.topRow}>
          <Text style={styles.fecha}>{formatearFecha(item?.fecha)}</Text>
          <View style={[styles.estadoChip, isRead ? styles.estadoLeida : styles.estadoNoLeida]}>
            <Text style={styles.estadoText}>{isRead ? 'Leída' : 'No leída'}</Text>
          </View>
        </View>

        <Text style={styles.titulo}>{item?.titulo || 'Notificación'}</Text>
        <Text style={styles.mensaje} numberOfLines={3}>{item?.mensaje || 'Sin mensaje.'}</Text>

        {!isRead ? <View style={styles.dotUnread} /> : null}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    shadowColor: '#0D243A',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 7,
    elevation: 2,
    position: 'relative',
  },
  cardUnread: {
    borderColor: '#B8D0FF',
    backgroundColor: '#F5F9FF',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  fecha: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  estadoChip: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  estadoLeida: {
    backgroundColor: 'rgba(15, 169, 104, 0.14)',
  },
  estadoNoLeida: {
    backgroundColor: 'rgba(23, 105, 255, 0.14)',
  },
  estadoText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  titulo: {
    color: colors.text,
    fontSize: fontSizes.medium,
    fontWeight: '700',
    marginBottom: 4,
  },
  mensaje: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    lineHeight: 20,
  },
  dotUnread: {
    position: 'absolute',
    top: 14,
    right: 14,
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.primary,
  },
});
