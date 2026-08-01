// SPDX-FileCopyrightText: Copyright 2025 Dr. Alejandro Sergio D'Alessandro
// SPDX-License-Identifier: Apache-2.0
/**
 * Información para el paciente — índice y lectura de artículos.
 *
 * Portado del fork anterior (Tailwind + heroicons) a Mantine 8. El contenido de
 * `articles.ts` se conserva **textual**: está adaptado de las guías ESC/SEC de
 * cardio-oncología para pacientes y reescribirlo sería una decisión clínica.
 */
import { Alert, Anchor, Badge, Card, Divider, Group, List, Stack, Text, Title } from '@mantine/core';
import { Document } from '@medplum/react';
import { IconAlertCircle, IconClock, IconDownload } from '@tabler/icons-react';
import type { JSX } from 'react';
import { Link, useParams } from 'react-router';
import type { ArticleBlock } from './articles';
import { GUIDE_PDF_PATH, infoArticles } from './articles';

/** Atribución de la fuente — se muestra en todas las vistas. */
function SourceNote(): JSX.Element {
  return (
    <Card withBorder padding="md" radius="md" bg="var(--mantine-color-gray-0)" mt="xl">
      <Text size="sm" c="dimmed">
        Adaptado de «Guías de práctica clínica ESC sobre cardio-oncología: Información para pacientes» — Sociedad
        Europea de Cardiología (ESC), Sociedad Española de Cardiología (SEC) y Fundación Española del Corazón. Este
        material es informativo y no reemplaza las indicaciones de tu equipo de salud.
      </Text>
      <Anchor href={GUIDE_PDF_PATH} download mt="xs" size="sm">
        <Group gap={4}>
          <IconDownload size={16} />
          Descargar la guía original (PDF)
        </Group>
      </Anchor>
    </Card>
  );
}

function Block({ block }: { block: ArticleBlock }): JSX.Element {
  switch (block.type) {
    case 'heading':
      return (
        <Title order={3} size="h4" mt="md">
          {block.text}
        </Title>
      );
    case 'list':
      return (
        <List spacing="xs" size="sm">
          {block.items.map((item) => (
            <List.Item key={item}>{item}</List.Item>
          ))}
        </List>
      );
    default:
      return <Text>{block.text}</Text>;
  }
}

/** Índice de artículos. */
export function InfoPage(): JSX.Element {
  return (
    <Document width={800}>
      <Stack gap="md">
        <div>
          <Title order={2}>Información para vos</Title>
          <Text c="dimmed" size="sm">
            Qué es la cardio-oncología, a qué prestar atención y qué podés hacer durante el tratamiento.
          </Text>
        </div>

        {infoArticles.map((article) => (
          <Card key={article.id} withBorder padding="md" radius="md" component={Link} to={`/info/${article.id}`}>
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <div>
                <Title order={3} size="h4">
                  {article.title}
                </Title>
                <Text size="sm" c="dimmed" mt={4}>
                  {article.teaser}
                </Text>
              </div>
              <Badge variant="light" leftSection={<IconClock size={12} />}>
                {article.readingMinutes} min
              </Badge>
            </Group>
          </Card>
        ))}

        <SourceNote />
      </Stack>
    </Document>
  );
}

/** Lectura de un artículo. */
export function ArticlePage(): JSX.Element {
  const { articleId } = useParams();
  const article = infoArticles.find((a) => a.id === articleId);

  if (!article) {
    return (
      <Document width={800}>
        <Alert icon={<IconAlertCircle />} color="gray" title="Artículo no encontrado">
          <Anchor component={Link} to="/info">
            Volver a Información
          </Anchor>
        </Alert>
      </Document>
    );
  }

  return (
    <Document width={800}>
      <Stack gap="sm">
        <Anchor component={Link} to="/info" size="sm">
          ← Información
        </Anchor>
        <Title order={2}>{article.title}</Title>

        <Alert color="teal" variant="light" title="Lo importante">
          {article.keyMessage}
        </Alert>

        <Divider my="xs" />

        {article.body.map((block, i) => (
          <Block key={i} block={block} />
        ))}

        {article.action?.href && (
          <Anchor component={Link} to={article.action.href} mt="md" fw={500}>
            {article.action.label} →
          </Anchor>
        )}

        <SourceNote />
      </Stack>
    </Document>
  );
}
