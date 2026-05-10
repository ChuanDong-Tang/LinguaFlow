import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { SafeAreaView } from "react-native-safe-area-context";
import { createProMonthlyOrder } from "../services/paymentApi";
import {
  clearPendingPaymentOrder,
  pollPaymentOrderUntilSettled,
  recoverPendingPaymentIfAny,
  savePendingPaymentOrder,
} from "../services/paymentRecovery";

type ProScreenProps = {
  onBack: () => void;
};

export function ProScreen({ onBack }: ProScreenProps) {
  const [isPaying, setIsPaying] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      const recovered = await recoverPendingPaymentIfAny();
      if (!mounted) return;
      if (recovered.status === "paid") {
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
      await savePendingPaymentOrder({
        orderId: order.id,
        providerOrderId: order.providerOrderId,
      });
      const settled = await pollPaymentOrderUntilSettled(order.id);
      if (settled.status === "paid") {
        await clearPendingPaymentOrder();
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
          <Ionicons name="chevron-back" size={28} color="#111111" />
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
          <Ionicons name="star-outline" size={76} color="#111111" style={styles.heroStar} />
          <Ionicons name="sparkles-outline" size={20} color="#A99BFF" style={styles.heroSpark} />
        </View>

        <Text style={styles.sectionTitle}>Pro 权益</Text>
        <View style={styles.benefitCard}>
          <BenefitItem
            icon="text-outline"
            title="更多每日字符额度"
            subtitle="普通版：每日 10,000 字\nPro 版：每日 100,000 字"
          />
          <BenefitItem icon="leaf-outline" title="支持更长文本改写" subtitle="更适合长句、长段落改写" />
          <BenefitItem icon="flash-outline" title="更高频使用" subtitle="适合每天持续练习和记录" isLast />
        </View>

        <View style={styles.priceCard}>
          <View style={styles.priceTop}>
            <View>
              <Text style={styles.priceTitle}>Pro 月度</Text>
              <View style={styles.priceRow}>
                <Text style={styles.price}>¥ xx</Text>
                <Text style={styles.priceUnit}> / 月</Text>
              </View>
              <Text style={styles.priceDesc}>每日 100,000 字额度</Text>
            </View>
            <Ionicons name="calendar-outline" size={72} color="#111111" />
          </View>

          <Pressable
            style={[styles.subscribeButton, isPaying && styles.subscribeButtonDisabled]}
            onPress={() => void handleSubscribe()}
            disabled={isPaying}
          >
            {isPaying ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.subscribeText}>开通 Pro</Text>
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
        <Ionicons name={icon} size={24} color="#111111" />
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
    backgroundColor: "#FFFFFF",
  },
  header: {
    height: 62,
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
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#E8E3FF",
    backgroundColor: "#FCFBFF",
    paddingHorizontal: 22,
    paddingVertical: 28,
    overflow: "hidden",
  },
  heroTitle: {
    color: "#111111",
    fontSize: 30,
    fontWeight: "500",
  },
  heroCopy: {
    marginTop: 12,
    color: "#4B5565",
    fontSize: 16,
    lineHeight: 24,
  },
  heroStar: {
    position: "absolute",
    right: 48,
    top: 54,
  },
  heroSpark: {
    position: "absolute",
    right: 46,
    top: 38,
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
    borderColor: "#ECEEF2",
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
    backgroundColor: "#F3F0FF",
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
    color: "#5F6675",
    fontSize: 14,
    lineHeight: 20,
  },
  priceCard: {
    marginTop: 22,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#EFE7D8",
    backgroundColor: "#FFFDF8",
    padding: 18,
  },
  priceTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  priceTitle: {
    color: "#111111",
    fontSize: 20,
    fontWeight: "700",
  },
  priceRow: {
    marginTop: 20,
    flexDirection: "row",
    alignItems: "baseline",
  },
  price: {
    color: "#8D83FF",
    fontSize: 28,
    fontWeight: "700",
  },
  priceUnit: {
    color: "#4B5565",
    fontSize: 17,
  },
  priceDesc: {
    marginTop: 12,
    color: "#5F6675",
    fontSize: 14,
  },
  subscribeButton: {
    marginTop: 22,
    height: 50,
    borderRadius: 12,
    backgroundColor: "#8D83FF",
    alignItems: "center",
    justifyContent: "center",
  },
  subscribeText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "600",
  },
  subscribeButtonDisabled: {
    opacity: 0.7,
  },
});
