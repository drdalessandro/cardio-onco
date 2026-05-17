// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Divider, Stack, Tabs } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeErrorString, Operator } from '@medplum/core';
import type { SearchRequest } from '@medplum/core';
import type { Patient, Resource } from '@medplum/fhirtypes';
import { Document, ResourceForm, ResourceHistoryTable, ResourceTable, SearchControl, useMedplum } from '@medplum/react';
import { IconCircleCheck, IconCircleOff } from '@tabler/icons-react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { cleanResource } from '../utils';
import { CardiotoxicityDashboard } from './CardiotoxicityDashboard';
import { ClinicalImpressionDisplay } from './ClinicalImpressionDisplay';
import { BiomarkerAlerts } from './BiomarkerAlerts';
import { HFAICOSCalculator } from './HFAICOSCalculator';
import { InterconsultaCardioOnco } from './InterconsultaCardioOnco';
import { MonitoringSchedule } from './MonitoringSchedule';
import { PatientObservations } from './PatientObservations';

interface PatientDetailsProps {
  patient: Patient;
  onChange: (patient: Patient) => void;
}

export function PatientDetails(props: PatientDetailsProps): JSX.Element {
  const medplum = useMedplum();
  const navigate = useNavigate();
  const id = props.patient.id;

  const tabs = [
    ['details', 'Detalles'],
    ['edit', 'Editar'],
    ['history', 'Historial'],
    ['encounter', 'Encuentros'],
    ['clinical', 'Impresiones Clínicas'],
    ['observations', 'Observaciones'],
    ['cardiotoxicity', 'Cardiotoxicidad'],
    ['monitoreo', 'Monitoreo ESC'],
    ['alertas', 'Alertas'],
    ['interconsulta', 'Interconsulta'],
  ];
  // Get the current tab
  const tab = window.location.pathname.split('/').pop();
  const currentTab = tab && tabs.map((t) => t[0]).includes(tab) ? tab : tabs[0][0];

  function handleTabChange(newTab: string | null): void {
    navigate(`/Patient/${id}/${newTab ?? ''}`)?.catch(console.error);
  }

  function handlePatientEdit(resource: Resource): void {
    medplum
      // Update the resource then re-render the page and go to the details tab
      .updateResource(cleanResource(resource))
      .then((patient) => {
        props.onChange(patient as Patient);
        showNotification({
          icon: <IconCircleCheck />,
          title: 'Success',
          message: 'Patient edited',
        });
        navigate(`/Patient/${id}/details`)?.catch(console.error);
        window.scrollTo(0, 0);
      })
      .catch((err) => {
        showNotification({
          color: 'red',
          icon: <IconCircleOff />,
          title: 'Error',
          message: normalizeErrorString(err),
        });
      });
  }

  const encounterSearch: SearchRequest = {
    resourceType: 'Encounter',
    filters: [{ code: 'patient', operator: Operator.EQUALS, value: `Patient/${id}` }],
    fields: ['date', 'patient', 'class'],
  };

  return (
    <Document>
      <Tabs value={currentTab.toLowerCase()} onChange={handleTabChange}>
        <Tabs.List mb="xs">
          {tabs.map((tab) => (
            <Tabs.Tab value={tab[0]} key={tab[0]}>
              {tab[1]}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="details">
          <ResourceTable value={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="edit">
          <ResourceForm defaultValue={props.patient} onSubmit={handlePatientEdit} />
        </Tabs.Panel>
        <Tabs.Panel value="history">
          <ResourceHistoryTable resourceType="Patient" id={id} />
        </Tabs.Panel>
        <Tabs.Panel value="encounter">
          <SearchControl
            search={encounterSearch}
            hideFilters={true}
            hideToolbar={true}
            onClick={(e) => navigate(`/${e.resource.resourceType}/${e.resource.id}`)?.catch(console.error)}
          />
        </Tabs.Panel>
        <Tabs.Panel value="clinical">
          <ClinicalImpressionDisplay patient={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="observations">
          <PatientObservations patient={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="cardiotoxicity">
          <CardiotoxicityDashboard patient={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="monitoreo">
          <Stack gap="xl" p="xs">
            <HFAICOSCalculator patient={props.patient} />
            <Divider />
            <MonitoringSchedule patient={props.patient} />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="alertas">
          <Stack p="xs">
            <BiomarkerAlerts patient={props.patient} />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="interconsulta">
          <Stack p="xs">
            <InterconsultaCardioOnco patient={props.patient} />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Document>
  );
}
