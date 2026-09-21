import { Stack } from "expo-router"
import { StatusBar } from "expo-status-bar"
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  useFonts,
} from "@expo-google-fonts/figtree"
import { AppRuntime } from "@/components/app-runtime"
import { colors } from "@/design/theme"

export default function RootLayout() {
  // Figtree is the desktop app's UI font — block first paint until it's
  // ready so nothing flashes in the platform default font.
  const [fontsLoaded] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  })
  if (!fontsLoaded) return null
  return (
    <>
      <StatusBar style="light" />
      <AppRuntime />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.canvas },
          animation: "slide_from_right",
        }}
      >
        <Stack.Screen name="index" options={{ animation: "none" }} />
        <Stack.Screen name="pair" options={{ animation: "fade" }} />
        <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
        <Stack.Screen name="chat/[id]" />
        <Stack.Screen name="chat/[id]/files" />
        <Stack.Screen name="chat/[id]/file" />
        <Stack.Screen name="chat/[id]/changes" />
      </Stack>
    </>
  )
}
