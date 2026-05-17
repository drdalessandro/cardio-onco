// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import type { JSX } from 'react';
import { Link } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';

export function LandingPage(): JSX.Element {
  return (
    <AuthLayout>
      <div
        style={{
          width: '100%',
          maxWidth: 380,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.25rem',
          textAlign: 'center',
          fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
        }}
      >
        <div>
          <h2
            style={{
              color: '#0f172a',
              fontSize: '1.85rem',
              fontWeight: 700,
              margin: '0 0 0.5rem',
              letterSpacing: '-0.3px',
            }}
          >
            ¡Bienvenido!
          </h2>
          <p style={{ color: '#64748b', margin: 0, lineHeight: 1.65, fontSize: '0.95rem' }}>
            Ingresá con tu cuenta para acceder al sistema de seguimiento de pacientes.
          </p>
        </div>

        <Link
          to="/signin"
          style={{
            display: 'block',
            width: '100%',
            padding: '0.875rem 1.5rem',
            background: 'linear-gradient(135deg, #1d4ed8 0%, #6d28d9 100%)',
            color: 'white',
            textDecoration: 'none',
            borderRadius: 50,
            fontWeight: 600,
            fontSize: '1rem',
            letterSpacing: '0.2px',
            transition: 'opacity 0.15s ease, transform 0.15s ease',
            boxShadow: '0 4px 20px rgba(109,40,217,0.35)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.9';
            e.currentTarget.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.style.transform = 'translateY(0)';
          }}
        >
          Iniciar Sesión
        </Link>

        <p style={{ color: '#94a3b8', fontSize: '0.8rem', margin: 0 }}>
          Acceso exclusivo para profesionales autorizados
        </p>
      </div>
    </AuthLayout>
  );
}
