import { QRCodeSVG } from "qrcode.react"

export function PairingQrCode({ value }: { value: string }) {
  return (
    <QRCodeSVG
      bgColor="#ffffff"
      fgColor="#09090b"
      level="M"
      marginSize={1}
      role="img"
      size={160}
      title="Scan to pair this device with BetterC0de"
      value={value}
    />
  )
}
