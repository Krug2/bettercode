import { ActivityIndicator, StyleSheet, Text, View } from "react-native"
import { Redirect } from "expo-router"
import { BrandMark, Screen } from "@/components/layout"
import { colors, font, spacing } from "@/design/theme"
import { useSessionStore } from "@/store/session-store"

/**
 * Startup gate: brand mark + quiet spinner while the stored session is
 * hydrated from the keychain and the desktop host is health-checked, then a
 * redirect to the tabs (paired) or the pairing flow (not paired).
 */
export default function IndexScreen() {
  const state = useSessionStore((store) => store.state)
  const profile = useSessionStore((store) => store.profile)
  if (state === "hydrating" || state === "checking") {
    return (
      <Screen edges={["top", "bottom"]}>
        <View style={styles.wrap}>
          <BrandMark />
          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text style={styles.statusText}>
              {state === "hydrating"
                ? "Restoring secure session…"
                : "Checking desktop connection…"}
            </Text>
          </View>
        </View>
      </Screen>
    )
  }
  return <Redirect href={profile ? "/(tabs)" : "/pair"} />
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xl,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  statusText: {
    color: colors.textSecondary,
    fontFamily: font.regular,
    fontSize: 13,
  },
})
