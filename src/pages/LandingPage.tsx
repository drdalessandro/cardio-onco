// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Anchor, Button, Stack, Text, Title } from '@mantine/core';
import { Document } from '@medplum/react';
import type { JSX } from 'react';
import { Link } from 'react-router';

export function LandingPage(): JSX.Element {
  return (
    <Document width={500}>
      <Stack align="center">
        <Title order={1} fz={36}>
          Bienvenido!
        </Title>
        <Text>
          Seguimiento, Cardio Oncología
        </Text>
        <Button component={Link} to="/signin" size="lg" radius="xl">
          Ingresar
        </Button>
      </Stack>
    </Document>
  );
}
