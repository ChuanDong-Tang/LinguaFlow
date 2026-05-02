import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function SplashGateScreen() {
  const dotOpacities = useRef([new Animated.Value(1), new Animated.Value(0.34), new Animated.Value(0.34)]).current;

  useEffect(() => {
    const steps = dotOpacities.map((_, activeIndex) =>
      Animated.parallel(
        dotOpacities.map((dot, index) =>
          Animated.timing(dot, {
            toValue: index === activeIndex ? 1 : 0.34,
            duration: 260,
            useNativeDriver: true,
          })
        )
      )
    );
    const loop = Animated.loop(Animated.sequence([...steps, Animated.delay(160)]));
    loop.start();

    return () => {
      loop.stop();
    };
  }, [dotOpacities]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centerWrap}>
        <Image
          source={require("../../assets/splash/logo.png")}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={styles.brandText}>OIO</Text>
        <Text style={styles.tagline}>把 话 说 得 更 自 然</Text>
      </View>
      <View style={styles.loadingDots} accessibilityLabel="正在加载">
        {dotOpacities.map((opacity, index) => (
          <Animated.View key={index} style={[styles.dot, { opacity }]} />
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  logoImage: {
    position: 'absolute',
    top: 150,
    width: 330,
    height: 330,
  },
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 74,
  },
  brandText: {
    marginTop: 220,
    fontSize: 42,
    fontWeight: "700",
    color: "#050505",
    letterSpacing: 8,
  },
  tagline: {
    marginTop: 8,
    color: "#8D9097",
    fontSize: 16,
    letterSpacing: 5,
  },
  loadingDots: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 118,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#948DF5",
  },
});
