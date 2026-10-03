import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Linking, Pressable, StyleSheet, Vibration, View } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { BarcodeScanningResult, BarcodeType, CameraView, PermissionResponse } from 'expo-camera'
import { Flashlight, FlashlightOff, ScanBarcode, X } from 'lucide-react-native'
import { isFoodBarcode } from '@ego/core'
import { color } from '../../components/money/tokens'
import { Button } from '../../components/ui/button'
import { Text } from '../../components/ui/text'
import { useFood } from '../../lib/food/context'
import { preparePhoto, type PreparedPhoto } from '../../lib/food/photo'
import { outsideApp } from '../../lib/private-lock'

type CameraModule = typeof import('expo-camera')

const FOOD_BARCODES: BarcodeType[] = ['ean13', 'ean8', 'upc_a', 'upc_e']
const STILL_TIMEOUT_MS = 2500
const FRAME = { width: 280, height: 170 }

/**
 * The camera is native code that only builds from 0.6.0 carry. Loading it on demand keeps an older
 * build, or a development build made before it, running everything else.
 */
async function loadCamera(): Promise<CameraModule | null> {
  try {
    return await import('expo-camera')
  } catch {
    return null
  }
}

/** The package as it was scanned, so the log has a picture. A slow camera is not worth waiting for. */
async function still(camera: CameraView | null): Promise<PreparedPhoto | null> {
  if (!camera) return null
  const shot = camera.takePictureAsync({ quality: 0.7, shutterSound: false })
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), STILL_TIMEOUT_MS))
  try {
    const picture = await Promise.race([shot, timeout])
    return picture ? await preparePhoto(picture.uri, picture.width, picture.height) : null
  } catch {
    return null
  }
}

function RoundButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }): React.ReactElement {
  return <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    hitSlop={8}
    className="h-12 w-12 items-center justify-center rounded-full bg-black/50 active:bg-black/70"
  >{children}</Pressable>
}

function Notice({ title, detail, action, onAction, onClose }: {
  title: string
  detail: string
  action?: string
  onAction?: () => void
  onClose: () => void
}): React.ReactElement {
  const insets = useSafeAreaInsets()
  return <View className="flex-1 bg-black px-8" style={{ paddingTop: insets.top + 8 }}>
    <RoundButton label="Close" onPress={onClose}><X color={color.text} size={24} /></RoundButton>
    <View className="flex-1 items-center justify-center">
      <ScanBarcode color={color.textMuted} size={40} />
      <Text className="mt-4 text-center text-[20px] font-semibold">{title}</Text>
      <Text className="mt-2 text-center text-[16px] leading-6 text-surface-400">{detail}</Text>
      {action && onAction && <Button className="mt-5" onPress={onAction}><Text>{action}</Text></Button>}
    </View>
  </View>
}

export default function Scan(): React.ReactElement {
  const router = useRouter()
  const [camera, setCamera] = useState<CameraModule | null | undefined>(undefined)
  const [permission, setPermission] = useState<PermissionResponse | null>(null)

  const ask = useCallback(async (module: CameraModule): Promise<void> => {
    const current = await module.Camera.getCameraPermissionsAsync()
    setPermission(current.granted || !current.canAskAgain
      ? current
      : await outsideApp(() => module.Camera.requestCameraPermissionsAsync()))
  }, [])

  useEffect(() => {
    let active = true
    void loadCamera().then((module) => {
      if (!active) return
      setCamera(module)
      if (module) void ask(module)
    })
    return () => { active = false }
  }, [ask])

  const close = (): void => router.back()
  if (camera === null) {
    return <Notice
      title="This build has no scanner"
      detail="Install the newest build from Settings to scan barcodes. Photos and descriptions work meanwhile."
      onClose={close}
    />
  }
  if (camera === undefined || permission === null) {
    return <View className="flex-1 items-center justify-center bg-black"><ActivityIndicator color={color.text} /></View>
  }
  if (!permission.granted) {
    return <Notice
      title="Camera access is off"
      detail="Ego needs the camera to read barcodes. Allow it in system settings."
      action={permission.canAskAgain ? 'Allow the camera' : 'Open settings'}
      onAction={() => void (permission.canAskAgain ? ask(camera) : Linking.openSettings())}
      onClose={close}
    />
  }
  return <Scanner camera={camera} />
}

function Scanner({ camera }: { camera: CameraModule }): React.ReactElement {
  const { mode } = useLocalSearchParams<{ mode?: string }>()
  const fridge = mode === 'fridge'
  const food = useFood()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const view = useRef<CameraView>(null)
  const handled = useRef(false)
  const open = useRef(true)
  const [torch, setTorch] = useState(false)
  const [busy, setBusy] = useState(false)
  const Preview = camera.CameraView

  useEffect(() => () => { open.current = false }, [])

  const scanned = async ({ data }: BarcodeScanningResult): Promise<void> => {
    const code = data.replace(/\D/g, '')
    if (handled.current || !isFoodBarcode(code)) return
    handled.current = true
    setBusy(true)
    Vibration.vibrate(40)
    if (fridge) {
      void food.stockBarcode(code)
    } else {
      const photo = await still(view.current)
      void food.logBarcode(code, photo)
    }
    // Close may have been tapped while the still was taken; a second back would leave Food.
    if (open.current) router.back()
  }

  return <View className="flex-1 bg-black">
    <Preview
      ref={view}
      style={StyleSheet.absoluteFill}
      facing="back"
      enableTorch={torch}
      barcodeScannerSettings={{ barcodeTypes: FOOD_BARCODES }}
      onBarcodeScanned={busy ? undefined : (result) => void scanned(result)}
    />
    <View pointerEvents="none" style={StyleSheet.absoluteFill} className="items-center justify-center">
      <View style={{ width: FRAME.width, height: FRAME.height, borderRadius: 24, borderWidth: 3, borderColor: busy ? color.positive : color.text }} />
      <View className="mt-6 rounded-full bg-black/60 px-4 py-2">
        <Text accessibilityLiveRegion="polite" className="text-[15px] font-medium">
          {busy ? 'Got it' : fridge ? 'Point at the barcode of something you bought' : 'Point at the barcode on the package'}
        </Text>
      </View>
    </View>
    <View style={{ position: 'absolute', top: insets.top + 8, left: 16, right: 16 }} className="flex-row justify-between">
      <RoundButton label="Close" onPress={() => router.back()}><X color={color.text} size={24} /></RoundButton>
      <RoundButton label={torch ? 'Turn the light off' : 'Turn the light on'} onPress={() => setTorch((on) => !on)}>
        {torch ? <FlashlightOff color={color.text} size={22} /> : <Flashlight color={color.text} size={22} />}
      </RoundButton>
    </View>
  </View>
}
