// SPDX-FileCopyrightText: Copyright Orangebot, Inc. and Medplum contributors
// SPDX-License-Identifier: Apache-2.0
import { Button, Menu, Tabs } from '@mantine/core';
import { formatSearchQuery, Operator } from '@medplum/core';
import type { SearchRequest } from '@medplum/core';
import type { Coding, Patient } from '@medplum/fhirtypes';
import { SearchControl } from '@medplum/react';
import { IconMenu2 } from '@tabler/icons-react';
import { useState } from 'react';
import type { JSX } from 'react';
import { useNavigate } from 'react-router';
import { ObservationGraph } from './graphs/ObservationGraph';

interface PatientObservationsProps {
  patient: Patient;
}

const pesoCoding: Coding = {
  system: 'http://loinc.org',
  code: '29463-7',
  display: 'peso',
};

const alturaCoding: Coding = {
  system: 'http://loinc.org',
  code: '8302-2',
  display: 'altura',
};

const presionArterialCoding: Coding = {
  system: 'http://loinc.org',
  code: '85354-9',
  display: 'presion-arterial',
};

const imcCoding: Coding = {
  system: 'http://loinc.org',
  code: '39156-5',
  display: 'imc',
};

const circunferenciaAbdominalCoding: Coding = {
  system: 'http://loinc.org',
  code: '8280-0',
  display: 'circunferencia-abdominal',
};

const frecuenciaCardiacaCoding: Coding = {
  system: 'http://loinc.org',
  code: '8867-4',
  display: 'frecuencia-cardiaca',
};

const duracionSuenoCoding: Coding = {
  system: 'http://loinc.org',
  code: '65981-9',
  display: 'duracion-sueno',
};

const duracionEjercicioCoding: Coding = {
  system: 'http://loinc.org',
  code: '55411-3',
  display: 'duracion-ejercicio',
};

const duracionPeriodoCoding: Coding = {
  system: 'http://loinc.org',
  code: '49033-4',
  display: 'duracion-periodo',
};

export function PatientObservations(props: PatientObservationsProps): JSX.Element {
  const navigate = useNavigate();

  const tabs = [
    ['todas', 'Todas las Observaciones'],
    ['altura', 'Altura'],
    ['peso', 'Peso'],
    ['circunferencia-abdominal', 'Circunferencia Abdominal'],
    ['presion-arterial', 'Presión Arterial'],
    ['frecuencia-cardiaca', 'Frecuencia Cardíaca'],
    ['imc', 'IMC'],
    ['duracion-sueno', 'Duración Sueño'],
    ['duracion-ejercicio', 'Duración Ejercicio'],
    ['duracion-periodo', 'Duración Período (Fem)'],
  ];
  const [currentTab, setCurrentTab] = useState<string[]>(tabs[0]);

  const search: SearchRequest = {
    resourceType: 'Observation',
    filters: [{ code: 'patient', operator: Operator.EQUALS, value: `Patient/${props.patient.id}` }],
    fields: ['status', 'code', 'focus'],
  };

  return (
    <div>
      <Menu>
        <Menu.Target>
          <Button leftSection={<IconMenu2 />} variant="default">
            {currentTab[1]}
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          {tabs.map((tab) => (
            <Menu.Item key={tab[0]} onClick={() => setCurrentTab(tab)}>
              {tab[1]}
            </Menu.Item>
          ))}
        </Menu.Dropdown>
      </Menu>
      <Tabs value={currentTab[0]} mt="md">
        <Tabs.Panel value="todas">
          <SearchControl
            search={search}
            hideFilters={true}
            hideToolbar={true}
            onClick={(e) => navigate(`/${e.resource.resourceType}/${e.resource.id}`)?.catch(console.error)}
            onChange={(e) => {
              navigate(`/${search.resourceType}${formatSearchQuery(e.definition)}`)?.catch(console.error);
            }}
          />
        </Tabs.Panel>
        <Tabs.Panel value="altura">
          <ObservationGraph code={alturaCoding} patient={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="peso">
          <ObservationGraph code={pesoCoding} patient={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="circunferencia-abdominal">
          <ObservationGraph code={circunferenciaAbdominalCoding} patient={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="presion-arterial">
          <ObservationGraph code={presionArterialCoding} patient={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="frecuencia-cardiaca">
          <ObservationGraph code={frecuenciaCardiacaCoding} patient={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="imc">
          <ObservationGraph code={imcCoding} patient={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="duracion-sueno">
          <ObservationGraph code={duracionSuenoCoding} patient={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="duracion-ejercicio">
          <ObservationGraph code={duracionEjercicioCoding} patient={props.patient} />
        </Tabs.Panel>
        <Tabs.Panel value="duracion-periodo">
          <ObservationGraph code={duracionPeriodoCoding} patient={props.patient} />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
