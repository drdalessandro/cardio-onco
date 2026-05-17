// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { SignInForm } from '@medplum/react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { AuthLayout } from '../components/AuthLayout';
import { getConfig } from '../config';

export function SignInPage(): JSX.Element {
  const navigate = useNavigate();
  return (
    <AuthLayout>
      <div style={{ width: '100%', maxWidth: 420, fontFamily: 'Inter, system-ui, -apple-system, sans-serif' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h2
            style={{
              color: '#0f172a',
              fontSize: '1.6rem',
              fontWeight: 700,
              margin: '0 0 0.35rem',
              letterSpacing: '-0.3px',
            }}
          >
            Iniciar Sesión
          </h2>
          <p style={{ color: '#64748b', margin: 0, fontSize: '0.9rem' }}>
            Cardio Oncología · Seguimiento Clínico
          </p>
        </div>

        <SignInForm
          googleClientId={getConfig().googleClientId}
          onSuccess={() => navigate('/')?.catch(console.error)}
          clientId={getConfig().clientId}
        >
          <span />
        </SignInForm>
      </div>
    </AuthLayout>
  );
}
