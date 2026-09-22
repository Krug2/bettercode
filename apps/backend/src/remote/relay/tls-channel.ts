import tls from "node:tls"
import type { Duplex } from "node:stream"
import { RELAY_HANDSHAKE_TIMEOUT } from "@betterc0de/remote-protocol"
import { certificateId, validatePeerCertificate, type DeviceIdentity } from "./identity"

const ALPN = "bettercode.remote/1"

export interface SecurePeer {
  socket: tls.TLSSocket
  id: string
  certificate: string
}

function awaitPeer(socket: tls.TLSSocket, event: "secure" | "secureConnect"): Promise<SecurePeer> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => socket.destroy(new Error("Device handshake timed out")), RELAY_HANDSHAKE_TIMEOUT)
    const failed = (error: Error) => { clearTimeout(timer); reject(error) }
    socket.on("error", failed)
    socket.once("close", () => failed(new Error("Device connection closed")))
    socket.once(event, () => {
      try {
        if (socket.getProtocol() !== "TLSv1.3" || socket.alpnProtocol !== ALPN)
          throw new Error("Incompatible device protocol")
        const raw = socket.getPeerCertificate().raw
        if (!raw) throw new Error("Device certificate is required")
        const certificate = validatePeerCertificate(raw)
        clearTimeout(timer)
        resolve({ socket, id: certificateId(raw), certificate: certificate.toString() })
      } catch (error) { socket.destroy(error as Error) }
    })
  })
}

export function secureClient(stream: Duplex, identity: DeviceIdentity, expectedCertificate: string): Promise<SecurePeer> {
  validatePeerCertificate(expectedCertificate)
  const expectedId = certificateId(expectedCertificate)
  const socket = tls.connect({
    socket: stream,
    minVersion: "TLSv1.3",
    maxVersion: "TLSv1.3",
    cert: identity.certificate,
    key: identity.privateKey,
    ca: expectedCertificate,
    rejectUnauthorized: true,
    servername: "bettercode.remote",
    ALPNProtocols: [ALPN],
    checkServerIdentity: (name, certificate) => {
      if (!certificate.raw || certificateId(certificate.raw) !== expectedId)
        return new Error("Remote device identity changed")
      return tls.checkServerIdentity(name, certificate)
    },
  })
  stream.on("error", error => socket.destroy(error))
  return awaitPeer(socket, "secureConnect")
}

export function secureServer(stream: Duplex, identity: DeviceIdentity): Promise<SecurePeer> {
  const socket = new tls.TLSSocket(stream, {
    isServer: true,
    secureContext: tls.createSecureContext({
      cert: identity.certificate,
      key: identity.privateKey,
      minVersion: "TLSv1.3",
      maxVersion: "TLSv1.3",
    }),
    requestCert: true,
    rejectUnauthorized: false,
    ALPNProtocols: [ALPN],
  })
  stream.on("error", error => socket.destroy(error))
  return awaitPeer(socket, "secure")
}
