import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  Easing,
} from 'react-native';
import { colors, spacing, fontSizes, radius } from '../styles/theme';

export default function LaunchIntroScreen() {
  const appear = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(appear, {
      toValue: 1,
      duration: 520,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: false,
        }),
      ])
    );

    const shimmerLoop = Animated.loop(
      Animated.timing(shimmer, {
        toValue: 1,
        duration: 1350,
        easing: Easing.linear,
        useNativeDriver: false,
      })
    );

    pulseLoop.start();
    shimmerLoop.start();

    return () => {
      pulseLoop.stop();
      shimmerLoop.stop();
    };
  }, [appear, pulse, shimmer]);

  const brandScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.035],
  });

  const glowOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.25, 0.55],
  });

  const shimmerTranslateX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-124, 124],
  });

  return (
    <View style={styles.container}>
      <View style={styles.backdrop} />
      <View style={[styles.mesh, styles.meshA]} />
      <View style={[styles.mesh, styles.meshB]} />
      <View style={[styles.mesh, styles.meshC]} />
      <View style={styles.gridVeil} />

      <Animated.View
        style={[
          styles.centerWrap,
          {
            opacity: appear,
            transform: [
              {
                translateY: appear.interpolate({
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
          <Text style={styles.kicker}>IMPULSA 360</Text>
        </View>

        <Animated.View
          style={[
            styles.glowRing,
            {
              opacity: glowOpacity,
              transform: [{ scale: brandScale }],
            },
          ]}
        />

        <Animated.View style={[styles.logoCard, { transform: [{ scale: brandScale }] }]}>
          <Image source={require('../assets/icon.png')} style={styles.logo} resizeMode="cover" />
        </Animated.View>

        <Text style={styles.title}>Activaciones en Campo</Text>
        <Text style={styles.subtitle}>Sincronización segura y operación inteligente</Text>

        <View style={styles.progressTrack}>
          <Animated.View
            style={[styles.progressShimmer, { transform: [{ translateX: shimmerTranslateX }] }]}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050D16',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#071223',
  },
  mesh: {
    position: 'absolute',
    borderRadius: 999,
  },
  meshA: {
    width: 360,
    height: 360,
    top: -150,
    left: -120,
    backgroundColor: 'rgba(46, 119, 255, 0.24)',
  },
  meshB: {
    width: 330,
    height: 330,
    bottom: -140,
    right: -120,
    backgroundColor: 'rgba(255, 138, 0, 0.16)',
  },
  meshC: {
    width: 220,
    height: 220,
    top: 200,
    right: -80,
    backgroundColor: 'rgba(23, 105, 255, 0.18)',
  },
  gridVeil: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.05,
    backgroundColor: '#0E2134',
  },
  centerWrap: {
    width: '84%',
    maxWidth: 360,
    alignItems: 'center',
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  kickerDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    marginRight: 8,
    backgroundColor: colors.accent,
  },
  kicker: {
    color: '#AFC4DB',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.1,
    fontWeight: '700',
  },
  glowRing: {
    position: 'absolute',
    top: 44,
    width: 176,
    height: 176,
    borderRadius: 999,
    backgroundColor: 'rgba(46, 119, 255, 0.33)',
  },
  logoCard: {
    width: 156,
    height: 156,
    borderRadius: radius.lg + 4,
    backgroundColor: '#0B1A2A',
    borderWidth: 1,
    borderColor: 'rgba(199, 218, 238, 0.22)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#04111F',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 10,
    marginBottom: spacing.lg,
  },
  logo: {
    width: 128,
    height: 128,
    borderRadius: 30,
  },
  title: {
    color: '#F4F8FF',
    fontSize: 25,
    fontWeight: '800',
    letterSpacing: 0.2,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    color: '#B7CBE0',
    fontSize: fontSizes.medium,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  progressTrack: {
    width: 180,
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(175, 196, 219, 0.2)',
  },
  progressShimmer: {
    width: 100,
    height: 6,
    borderRadius: 999,
    backgroundColor: '#2E77FF',
  },
});
