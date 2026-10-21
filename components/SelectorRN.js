import React, { useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, fontSizes, radius, spacing } from '../styles/theme';

const valueMatches = (left, right) => Object.is(left, right);

export default function SelectorRN({
  selectedValue,
  onValueChange,
  options = [],
  enabled = true,
  style,
  accessibilityLabel,
}) {
  const [visible, setVisible] = useState(false);
  const selectedOption = useMemo(
    () => options.find((item) => valueMatches(item.value, selectedValue)),
    [options, selectedValue]
  );
  const selectedLabel = selectedOption?.label || options[0]?.label || '';

  const close = () => setVisible(false);
  const open = () => {
    if (enabled) setVisible(true);
  };

  const choose = (item) => {
    close();
    if (!enabled) return;
    onValueChange?.(item.value);
  };

  useEffect(() => {
    if (!enabled && visible) close();
  }, [enabled, visible]);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || selectedLabel}
        accessibilityState={{ disabled: !enabled, expanded: visible }}
        disabled={!enabled}
        onPress={open}
        style={[styles.trigger, style, !enabled && styles.disabled]}
      >
        <Text
          numberOfLines={1}
          style={[styles.triggerText, !selectedOption && styles.placeholderText]}
        >
          {selectedLabel}
        </Text>
        <Text style={styles.chevron}>v</Text>
      </Pressable>

      <Modal
        visible={visible}
        transparent
        animationType="fade"
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close}>
          <Pressable style={styles.card} onPress={() => {}}>
            <View style={styles.header}>
              <Text style={styles.title}>Seleccionar</Text>
              <Pressable accessibilityRole="button" onPress={close} style={styles.closeButton}>
                <Text style={styles.closeText}>Cerrar</Text>
              </Pressable>
            </View>
            <FlatList
              data={options}
              keyExtractor={(item, index) => `${String(item.value)}:${index}`}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
                const selected = valueMatches(item.value, selectedValue);
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => choose(item)}
                    style={[styles.option, selected && styles.optionSelected]}
                  >
                    <Text style={[styles.optionText, item.color ? { color: item.color } : null]}>
                      {item.label}
                    </Text>
                    {selected ? <Text style={styles.selectedMark}>Seleccionado</Text> : null}
                  </Pressable>
                );
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    backgroundColor: colors.inputBackground,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  disabled: {
    opacity: 0.55,
  },
  triggerText: {
    flex: 1,
    color: colors.text,
    fontSize: fontSizes.medium,
    fontWeight: '600',
  },
  placeholderText: {
    color: colors.textMuted,
  },
  chevron: {
    color: colors.textMuted,
    fontSize: fontSizes.small,
    fontWeight: '900',
    marginLeft: spacing.sm,
  },
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.md,
  },
  card: {
    maxHeight: '82%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: fontSizes.medium,
    fontWeight: '800',
  },
  closeButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  closeText: {
    color: colors.primary,
    fontWeight: '800',
  },
  option: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: 'center',
  },
  optionSelected: {
    backgroundColor: colors.surfaceAlt,
  },
  optionText: {
    color: colors.text,
    fontSize: fontSizes.medium,
    fontWeight: '700',
  },
  selectedMark: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },
});
