import React from "react";
import { StyleSheet, Text, View, Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function SplashGateScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centerWrap}>
        <Image
          source={require("../../assets/app/logo.png")}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={styles.brandText}>OIO</Text>
        <Text style={styles.tagline}>Output ・ Input ・ Output</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F7F7",
    overflow: "hidden",
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -72,
  },
  brandText: {
    marginTop: -30,
    fontSize: 20,
    fontWeight: "400",
    color: "#050505",
    letterSpacing: 0.8,
  },
  tagline: {
    marginTop: 10,
    color: "#4A4A4A",
    fontSize: 14,
    letterSpacing: 0.6,
  },
  logoImage: {
    width: 180,
    height: 180,
  },
});
