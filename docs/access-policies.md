# AccessPolicy — Cardio-Oncología Marie Curie

Tres perfiles de acceso sobre **un mismo Project**: paciente, equipo clínico e
investigación. Se instalan con `npm run bootstrap` desde
`data/core/access-policies.json` — versionadas, revisables en un diff y con
tests, en vez de configuradas a mano en la consola de administración.

| Política | Quién | Alcance |
|---|---|---|
| `cardio-onco-patient` | Paciente (app Programas) | Sólo su compartimento. Puede cargar datos, no diagnosticar |
| `cardio-onco-clinician` | Cardio-oncólogos | Escritura clínica completa; definiciones sólo lectura |
| `cardio-onco-researcher` | Investigación / agente LLM | **Sólo lectura, sin identificadores** |

## Por qué esto es imprescindible, no una formalidad

El front del paciente lee por ID tomado de la URL:

```ts
const { observationId = '' } = useParams();
medplum.readResource('Observation', observationId).read();
```

y filtra del lado del cliente (`search('Observation', 'patient=' + …)`). **Ese
filtro no es una defensa**: es un parámetro que el cliente elige. Sumado a que
el registro de pacientes está abierto, sin política del lado del servidor
cualquiera se registra y cambia un ID en la URL para leer datos de otro
paciente.

Por eso el paso decisivo del despliegue es que `cardio-onco-patient` quede como
**default patient access policy** del Project: si no, los registros nuevos
entran sin restricción.

## Decisiones que tienen contrapartida

**`Binary` NO está en la política del paciente.** Es la decisión más restrictiva
y es deliberada: `Binary` no es compartimentable, así que concederlo es
concederlo *para todo el proyecto*. Y en este proyecto el bootstrap guarda **el
código fuente de los bots en recursos `Binary`**. Hoy no se pierde nada porque
el front del paciente no usa adjuntos. Cuando se habiliten (foto de perfil, PDF
de laboratorio), hay que agregar:

```json
{ "resourceType": "Binary", "interaction": ["read", "create"] }
```

y asumir explícitamente el riesgo residual: un paciente podría leer cualquier
`Binary` cuyo id conozca. Mitigación: mover el código de los bots fuera de
`Binary`, o auditar los accesos.

**`PaymentNotice` tampoco está.** La página de facturación viene heredada de
FooMedical y no tiene sentido en un hospital público: se saca del front en vez
de concederle permiso.

**`Practitioner` con `hiddenFields`.** El paciente necesita ver el nombre de su
médico, pero no su teléfono, domicilio ni matrícula.

**El paciente no puede modificar su `identifier` ni marcarse fallecido**
(`readonlyFields`), aunque sí edita el resto de su perfil.

## El perfil de investigación

Es el que usaría el agente LLM. Dos propiedades:

1. **Sólo lectura, sin excepción.** Ninguna entrada permite `create`/`update`/
   `delete`. Un agente no debería poder escribir en la historia clínica.
2. **Seudonimizado por `hiddenFields`.** Se ocultan nombre, contacto, domicilio,
   foto, identificadores — y el **texto libre** (`note`, `conclusion`,
   `presentedForm`), que es donde en la práctica se filtra PHI. Se conservan
   `birthDate` y `gender` porque son variables de análisis (y entradas de los
   scores).

Incluye `Group`, `ResearchStudy` y `ResearchSubject`: las cohortes son recursos
de primera clase, no filtros ad-hoc.

> ⚠️ `hiddenFields` reduce la exposición, **no es anonimización**. Una cohorte
> chica con fecha de nacimiento y diagnóstico sigue siendo reidentificable. Para
> publicar hace falta agregación o supresión de celdas chicas — decisión del
> comité de ética, no del código.

## Verificación

`src/cardiotox-mapping/access-policies.test.ts` (21 tests) protege cuatro
invariantes, para que aflojar una política ponga un test en rojo:

1. Todo recurso clínico del paciente está acotado a `%patient`.
2. Ninguna política concede `AccessPolicy`, `Bot`, `ClientApplication`, `User`,
   `ProjectMembership`, `Project`, `Subscription`… (escalada de privilegios).
3. Investigación es sólo lectura y oculta identificadores.
4. El clínico puede escribir **todo lo que produce el migrador**
   (`Patient`, `Observation`, `Condition`, `MedicationStatement`,
   `RiskAssessment`, `Goal`) — si no, la migración falla a mitad de camino.

Hay además un test de cobertura del front: si la app del paciente consume un
recurso que la política no concede, la página daría 403. Así se detectó que
faltaba `Immunization` (página de Vacunas).

## Pendiente de validar contra el servidor

Estas políticas **no se probaron contra `api.medplum.com.ar`** (el entorno de
desarrollo no tiene salida a ese host). Antes de abrir a pacientes reales:

1. Instalarlas con `npm run bootstrap -- --execute`.
2. Marcar `cardio-onco-patient` como *default patient access policy* del Project.
3. **Probar el ataque**: con un usuario paciente de prueba, pedir por ID una
   `Observation` de otro paciente y confirmar que devuelve 403.

El paso 3 no es opcional. Es la única forma de saber que la política funciona.
