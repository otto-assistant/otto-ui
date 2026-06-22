/**
 * Voice Store — voice connection and activity state.
 * Extracted from session-ui-store for subscription isolation.
 */

export type VoiceStatus = "disconnected" | "connecting" | "connected" | "error"
export type VoiceMode = "idle" | "speaking" | "listening"

export type VoiceState = {
  voiceStatus: VoiceStatus
  voiceMode: VoiceMode
  setVoiceStatus: (status: VoiceStatus) => void
  setVoiceMode: (mode: VoiceMode) => void
}
