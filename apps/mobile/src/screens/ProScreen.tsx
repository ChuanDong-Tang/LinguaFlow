import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { createProMonthlyOrder } from "../services/api/paymentApi";
import {
  clearPendingPaymentOrder,
  pollPaymentOrderUntilSettled,
  recoverPendingPaymentIfAny,
  savePendingPaymentOrder,
} from "../services/payment/paymentRecovery";

type ProScreenProps = { onBack: () => void };

export function ProScreen({ onBack }: ProScreenProps) {
  const [isPaying, setIsPaying] = useState(false);
  const [isRenew, setIsRenew] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      // 页面打开时先恢复未完成订单，处理用户支付后返回 App 的场景。
      const recovered = await recoverPendingPaymentIfAny();
      if (!mounted) return;
      if (recovered.status === "paid") {
        setIsRenew(true);
        Alert.alert("开通成功", "Pro 权益已生效。");
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSubscribe(): Promise<void> {
    if (isPaying) return;
    setIsPaying(true);
    try {
      const order = await createProMonthlyOrder();
      await savePendingPaymentOrder({ orderId: order.id, providerOrderId: order.providerOrderId });

      // 支付完成通常需要后端确认，这里轮询到终态再更新本地展示。
      const settled = await pollPaymentOrderUntilSettled(order.id);
      if (settled.status === "paid") {
        await clearPendingPaymentOrder();
        setIsRenew(true);
        Alert.alert("开通成功", "Pro 权益已生效。");
        return;
      }
      if (settled.status === "pending") {
        Alert.alert("支付处理中", "订单状态仍在确认中，稍后会自动继续同步。");
        return;
      }
      await clearPendingPaymentOrder();
      Alert.alert("支付未完成", `当前状态：${settled.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "请稍后重试";
      Alert.alert("支付发起失败", message);
    } finally {
      setIsPaying(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onBack} hitSlop={10}>
          <Ionicons name="arrow-back" size={30} color="#111111" />
        </Pressable>
        <Text style={styles.headerTitle}>OIO Pro</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroCard}>
          <View>
            <Text style={styles.heroTitle}>OIO Pro</Text>
            <Text style={styles.heroCopy}>更充足的字符额度，</Text>
            <Text style={styles.heroCopy}>让表达练习更自由。</Text>
          </View>
          <View style={styles.heroShape}>
            <View style={styles.heroCircle} />
            <View style={styles.heroSquare} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Pro 权益</Text>
        <View style={styles.benefitCard}>
          <BenefitItem icon="text-outline" title="更多每日字符额度" subtitle="普通版：每日 10,000 字\nPro 版：每日 100,000 字" />
          <BenefitItem icon="leaf-outline" title="支持更长文本改写" subtitle="更适合长句、长段落改写" />
          <BenefitItem icon="flash-outline" title="更高频使用" subtitle="适合每天持续练习和记录" isLast />
        </View>

        <View style={styles.priceCard}>
          <View style={styles.priceHead}>
            <Text style={styles.priceTitle}>Pro 月度</Text>
            {isRenew ? <Text style={styles.expire}>到期时间：2026年6月11日</Text> : null}
          </View>
          <View style={styles.priceRow}>
            <Text style={styles.price}>¥ xx</Text>
            <Text style={styles.priceUnit}> / 月</Text>
          </View>
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              测试说明：后续接入更多功能后，{"\n"}Pro 权益与价格可能会调整，具体请以当前页面展示为准。
            </Text>
          </View>
          <Pressable
            style={[styles.subscribeButton, isPaying && styles.subscribeButtonDisabled]}
            onPress={() => void handleSubscribe()}
            disabled={isPaying}
          >
            {isPaying ? (
              <ActivityIndicator color="#111111" />
            ) : (
              <Text style={styles.subscribeText}>{isRenew ? "续费 Pro" : "开通 Pro"}</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function BenefitItem({
  icon,
  title,
  subtitle,
  isLast,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  title: string;
  subtitle: string;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.benefitItem, !isLast && styles.benefitItemBorder]}>
      <View style={styles.benefitIcon}>
        <Ionicons name={icon} size={22} color="#111111" />
      </View>
      <View style={styles.benefitCopy}>
        <Text style={styles.benefitTitle}>{title}</Text>
        <Text style={styles.benefitSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FCFCFD",
  },

  header: {
    height: 60,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: "#111111",
    fontSize: 21,
    fontWeight: "600",
  },

  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },

  heroCard: {
    minHeight: 170,
    paddingHorizontal: 22,
    paddingVertical: 28,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E5E2FF",
    backgroundColor: "#F8F7FF",
    overflow: "hidden",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  heroTitle: {
    color: "#111111",
    fontSize: 24,
    fontWeight: "600",
  },
  heroCopy: {
    marginTop: 10,
    color: "#44527E",
    fontSize: 16,
    lineHeight: 24,
  },
  heroShape: {
    width: 140,
    alignItems: "center",
    justifyContent: "center",
  },
  heroCircle: {
    position: "absolute",
    top: 12,
    left: 20,
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: "#6C62FF",
  },
  heroSquare: {
    position: "absolute",
    top: 44,
    left: 52,
    width: 68,
    height: 68,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: "#6C62FF",
  },

  sectionTitle: {
    marginTop: 24,
    marginBottom: 12,
    color: "#111111",
    fontSize: 20,
    fontWeight: "700",
  },
  benefitCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E5EB",
    backgroundColor: "#FFFFFF",
    overflow: "hidden",
  },
  benefitItem: {
    minHeight: 86,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  benefitItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#ECEEF2",
  },
  benefitIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#DDE2EC",
    alignItems: "center",
    justifyContent: "center",
  },
  benefitCopy: {
    flex: 1,
    marginLeft: 14,
  },
  benefitTitle: {
    color: "#111111",
    fontSize: 17,
    fontWeight: "700",
  },
  benefitSubtitle: {
    marginTop: 6,
    color: "#44527E",
    fontSize: 14,
    lineHeight: 20,
  },

  priceCard: {
    marginTop: 22,
    padding: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E2E5EB",
    backgroundColor: "#FFFFFF",
  },
  priceHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  priceTitle: {
    color: "#111111",
    fontSize: 20,
    fontWeight: "700",
  },
  expire: {
    color: "#6A7290",
    fontSize: 15,
  },
  priceRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "baseline",
  },
  price: {
    color: "#6E63FF",
    fontSize: 46,
    fontWeight: "700",
  },
  priceUnit: {
    color: "#3E4761",
    fontSize: 15,
  },
  noteBox: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "#F5F4FF",
  },
  noteText: {
    color: "#59617B",
    fontSize: 14,
    lineHeight: 22,
  },
  subscribeButton: {
    marginTop: 16,
    height: 54,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#111111",
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  subscribeButtonDisabled: {
    opacity: 0.7,
  },
  subscribeText: {
    color: "#111111",
    fontSize: 18,
    fontWeight: "500",
  },
});
