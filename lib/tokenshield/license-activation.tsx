"use client"

/**
 * TokenShield - License Activation Component
 *
 * A self-contained React component for self-serve license activation.
 * Handles key input, validation feedback, tier display, and feature
 * unlock confirmation.
 *
 * Usage:
 *   import { LicenseActivation } from '@tokenshield/ai-sdk'
 *
 *   <LicenseActivation
 *     onActivated={(info) => console.log('Licensed:', info.tier)}
 *     secret={process.env.NEXT_PUBLIC_TS_SECRET}
 *   />
 */

import React, { useState, useCallback } from "react"
import {
  activateLicense,
  getLicenseInfo,
  setLicenseSecret,
  getModulesForTier,
  type LicenseInfo,
  type LicenseTier,
} from "./license"

// -------------------------------------------------------
// Types
// -------------------------------------------------------

export interface LicenseActivationProps {
  /** Called after successful activation */
  onActivated?: (info: LicenseInfo) => void
  /** Called on activation failure */
  onError?: (error: string) => void
  /** Optional HMAC secret for server-side validation (set before render) */
  secret?: string
  /** Custom placeholder text */
  placeholder?: string
  /** CSS class name for the outer container */
  className?: string
  /** Inline styles for the outer container */
  style?: React.CSSProperties
}

// -------------------------------------------------------
// Tier display helpers
// -------------------------------------------------------

const TIER_LABELS: Record<LicenseTier, string> = {
  community: "Community (Free)",
  pro: "Pro",
  team: "Team",
  enterprise: "Enterprise",
}

const TIER_COLORS: Record<LicenseTier, string> = {
  community: "#6b7280",
  pro: "#3b82f6",
  team: "#8b5cf6",
  enterprise: "#f59e0b",
}

// -------------------------------------------------------
// Component
// -------------------------------------------------------

export function LicenseActivation({
  onActivated,
  onError,
  secret,
  placeholder = "Paste your license key...",
  className,
  style,
}: LicenseActivationProps) {
  const [keyInput, setKeyInput] = useState("")
  const [status, setStatus] = useState<"idle" | "validating" | "success" | "error">("idle")
  const [licenseInfo, setLicenseInfo] = useState<LicenseInfo>(getLicenseInfo)
  const [errorMsg, setErrorMsg] = useState("")

  const handleActivate = useCallback(async () => {
    const trimmed = keyInput.trim()
    if (!trimmed) return

    setStatus("validating")
    setErrorMsg("")

    try {
      if (secret) {
        setLicenseSecret(secret)
      }

      const info = await activateLicense(trimmed)
      setLicenseInfo(info)

      if (info.valid) {
        setStatus("success")
        onActivated?.(info)
      } else {
        const msg = info.expiresAt && Date.now() > info.expiresAt
          ? "License key has expired."
          : "Invalid license key. Please check your key and try again."
        setStatus("error")
        setErrorMsg(msg)
        onError?.(msg)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Activation failed"
      setStatus("error")
      setErrorMsg(msg)
      onError?.(msg)
    }
  }, [keyInput, secret, onActivated, onError])

  const currentModules = getModulesForTier(licenseInfo.tier)

  return (
    <div
      className={className}
      style={{
        padding: 20,
        borderRadius: 12,
        border: "1px solid #e5e7eb",
        background: "#ffffff",
        fontFamily: "system-ui, -apple-system, sans-serif",
        maxWidth: 480,
        ...style,
      }}
    >
      <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 700 }}>
        License Activation
      </h3>

      {/* Current status */}
      <div
        style={{
          padding: "8px 12px",
          borderRadius: 8,
          background: "#f9fafb",
          marginBottom: 16,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 12, color: "#6b7280" }}>Current tier</span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: TIER_COLORS[licenseInfo.tier],
          }}
        >
          {TIER_LABELS[licenseInfo.tier]}
        </span>
      </div>

      {/* Key input */}
      <div style={{ marginBottom: 12 }}>
        <textarea
          value={keyInput}
          onChange={(e) => {
            setKeyInput(e.target.value)
            if (status !== "idle") setStatus("idle")
          }}
          placeholder={placeholder}
          rows={3}
          style={{
            width: "100%",
            padding: "8px 12px",
            border: `1px solid ${status === "error" ? "#ef4444" : status === "success" ? "#22c55e" : "#d1d5db"}`,
            borderRadius: 8,
            fontSize: 13,
            fontFamily: "monospace",
            resize: "vertical",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Activate button */}
      <button
        onClick={handleActivate}
        disabled={!keyInput.trim() || status === "validating"}
        style={{
          width: "100%",
          padding: "10px 16px",
          borderRadius: 8,
          border: "none",
          background: status === "validating" ? "#9ca3af" : "#3b82f6",
          color: "#fff",
          fontSize: 14,
          fontWeight: 600,
          cursor: !keyInput.trim() || status === "validating" ? "not-allowed" : "pointer",
          opacity: !keyInput.trim() ? 0.5 : 1,
          marginBottom: 12,
        }}
      >
        {status === "validating" ? "Validating..." : "Activate License"}
      </button>

      {/* Success message */}
      {status === "success" && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: "#16a34a", marginBottom: 4 }}>
            License activated successfully
          </div>
          <div style={{ fontSize: 12, color: "#15803d" }}>
            Tier: {TIER_LABELS[licenseInfo.tier]} | Holder: {licenseInfo.holder}
            {licenseInfo.expiresAt && (
              <> | Expires: {new Date(licenseInfo.expiresAt).toLocaleDateString()}</>
            )}
          </div>
        </div>
      )}

      {/* Error message */}
      {status === "error" && (
        <div
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 12, color: "#dc2626" }}>{errorMsg}</div>
        </div>
      )}

      {/* Unlocked modules */}
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Unlocked Modules ({currentModules.length})
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {currentModules.map((mod) => (
            <span
              key={mod}
              style={{
                padding: "2px 8px",
                borderRadius: 4,
                background: "#f3f4f6",
                fontSize: 11,
                color: "#374151",
              }}
            >
              {mod}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
