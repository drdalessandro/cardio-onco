// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { JSX, ReactNode } from 'react';

function HeartEcgLogo(): JSX.Element {
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Glow ring */}
      <circle cx="44" cy="44" r="42" stroke="rgba(167,139,250,0.3)" strokeWidth="1.5" />
      <circle cx="44" cy="44" r="36" stroke="rgba(167,139,250,0.15)" strokeWidth="1" />
      {/* Heart */}
      <path
        d="M44 72 C22 55, 8 46, 8 29 C8 18, 17 10, 27 10 C33 10, 38 13, 44 20 C50 13, 55 10, 61 10 C71 10, 80 18, 80 29 C80 46, 66 55, 44 72Z"
        fill="rgba(255,255,255,0.12)"
        stroke="rgba(255,255,255,0.85)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      {/* ECG line through heart */}
      <path
        d="M14,38 L26,38 L30,28 L35,48 L39,38 L49,38 L53,24 L58,52 L62,38 L74,38"
        fill="none"
        stroke="white"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Oncology ribbon — top-right of heart */}
      <path d="M62,13 C70,5 82,8 79,16 C76,23 66,18 62,13Z" fill="#a78bfa" />
      <path d="M62,13 C67,20 65,30 72,33 C67,28 58,22 62,13Z" fill="#a78bfa" />
    </svg>
  );
}

function EcgDecoration(): JSX.Element {
  return (
    <div style={{ position: 'absolute', bottom: '12%', left: 0, right: 0, opacity: 0.18, pointerEvents: 'none' }}>
      <svg viewBox="0 0 900 100" width="100%" preserveAspectRatio="none" height="80">
        <path
          d="M0,50 L90,50 L110,50 L130,10 L150,90 L170,50 L220,50 L310,50 L330,50 L350,10 L370,90 L390,50 L440,50 L530,50 L550,50 L570,10 L590,90 L610,50 L660,50 L750,50 L770,10 L790,90 L810,50 L900,50"
          fill="none"
          stroke="white"
          strokeWidth="2.5"
        />
      </svg>
    </div>
  );
}

function FeaturePill({ color, label }: { color: string; label: string }): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.4rem',
        color: 'rgba(255,255,255,0.65)',
        fontSize: '0.8rem',
        background: 'rgba(255,255,255,0.07)',
        padding: '0.3rem 0.75rem',
        borderRadius: 20,
        border: '1px solid rgba(255,255,255,0.1)',
      }}
    >
      <div style={{ width: 7, height: 7, borderRadius: '50%', background: color, flexShrink: 0 }} />
      {label}
    </div>
  );
}

interface AuthLayoutProps {
  children: ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps): JSX.Element {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        zIndex: 1000,
        fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
      }}
    >
      {/* ── Left panel ── */}
      <div
        style={{
          flex: '0 0 55%',
          background: 'linear-gradient(145deg, #0d0b1e 0%, #1a1040 30%, #2d1b69 65%, #4c1d95 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '2.5rem',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Ambient blobs */}
        <div
          style={{
            position: 'absolute',
            top: '-120px',
            right: '-120px',
            width: 400,
            height: 400,
            borderRadius: '50%',
            background: 'rgba(124,58,237,0.22)',
            filter: 'blur(60px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-100px',
            left: '-100px',
            width: 350,
            height: 350,
            borderRadius: '50%',
            background: 'rgba(26,86,219,0.18)',
            filter: 'blur(50px)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: '45%',
            left: '-60px',
            width: 220,
            height: 220,
            borderRadius: '50%',
            background: 'rgba(167,139,250,0.12)',
            filter: 'blur(35px)',
          }}
        />

        {/* Content */}
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', maxWidth: 360 }}>
          <HeartEcgLogo />

          <h1
            style={{
              color: 'white',
              textAlign: 'center',
              fontSize: '2rem',
              fontWeight: 700,
              margin: 0,
              lineHeight: 1.2,
              letterSpacing: '-0.3px',
            }}
          >
            Cardio Oncología
          </h1>

          <p
            style={{
              color: 'rgba(255,255,255,0.7)',
              textAlign: 'center',
              margin: 0,
              lineHeight: 1.65,
              fontSize: '0.975rem',
            }}
          >
            Plataforma integral para el monitoreo y protección cardiovascular del paciente oncológico.
          </p>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '0.5rem' }}>
            <FeaturePill color="#a78bfa" label="Seguimiento Cardiotoxicidad" />
            <FeaturePill color="#60a5fa" label="Historial Clínico" />
            <FeaturePill color="#34d399" label="Encuentros Médicos" />
          </div>
        </div>

        <EcgDecoration />
      </div>

      {/* ── Right panel ── */}
      <div
        style={{
          flex: '0 0 45%',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '3rem 2.5rem',
          overflowY: 'auto',
        }}
      >
        {children}
      </div>
    </div>
  );
}
