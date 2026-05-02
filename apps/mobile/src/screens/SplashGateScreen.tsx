import React from "react";
import { StyleSheet, View, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export function SplashGateScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.centerWrap}>
        {/* 先用文字 O 占位 logo，后面换成图片 */}
        <Text style={styles.logoText}>O</Text>
        <View style={styles.shadow} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF"
  },
  centerWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  logoText: {
    fontSize: 72,
    fontWeight: "700",
    color: "#111111",
    letterSpacing: 2
  },
  shadow: {
    marginTop: 10,
    width: 80,
    height: 12,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.08)"
  }
});
