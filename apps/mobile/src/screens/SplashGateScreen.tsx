import React from "react";
import { StyleSheet, Text, View, Image } from "react-native";

export function SplashGateScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.centerWrap}>
        <Image
          source={require("../../assets/app/logo.png")}
          style={styles.logoImage}
          resizeMode="contain"
        />
        <Text style={styles.brandText}>OIO</Text>
        <Text style={styles.tagline}>Output ・ Input ・ Output</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F7F7",
    overflow: "hidden",
  },
  centerWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: "50%",
    transform: [{ translateY: -175 }],
    alignItems: "center",
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
